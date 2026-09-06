#include "UpdateService.hpp"

#include "update/Manifest.hpp"
#include "update/Updater.hpp"
#include "update/Version.hpp"

#include <fcntl.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <vector>

extern char** environ;

namespace forge::desktop {
namespace {

std::string readAll(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return {};
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

// Runs argv with NO SHELL and waits. Returns the process's exit status, or -1 if
// it could not be started or did not exit normally; the tail of its combined
// output lands in `out` because "the updater failed" without the updater's own
// message is a bug report nobody can action.
//
// This is a deliberate second copy of the same shape as Updater.cpp's private
// runProcess, and not a shared helper, for one reason: that one folds a non-zero
// exit into an error string, and the caller here has to DISTINGUISH exit codes --
// forge_update answers 10 for "already current", which is not a failure. Exporting
// it and widening its contract to serve both callers would make a tested internal
// of the updater library depend on an app-layer need.
int runAndCapture(const std::vector<std::string>& argv, std::string& out) {
  out.clear();
  if (argv.empty()) return -1;
  std::error_code ec;
  const std::filesystem::path log =
      std::filesystem::temp_directory_path(ec) /
      ("forge-update-apply-" + std::to_string(::getpid()) + ".log");

  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions) != 0) return -1;
  posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, log.c_str(),
                                   O_WRONLY | O_CREAT | O_TRUNC, 0600);
  posix_spawn_file_actions_adddup2(&actions, STDOUT_FILENO, STDERR_FILENO);

  std::vector<char*> cargv;
  cargv.reserve(argv.size() + 1);
  for (const std::string& a : argv) cargv.push_back(const_cast<char*>(a.c_str()));
  cargv.push_back(nullptr);

  ::pid_t pid = 0;
  const int rc = posix_spawn(&pid, argv[0].c_str(), &actions, nullptr, cargv.data(), environ);
  posix_spawn_file_actions_destroy(&actions);
  if (rc != 0) {
    out = argv[0] + ": " + std::strerror(rc);
    std::filesystem::remove(log, ec);
    return -1;
  }

  int status = 0;
  while (::waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      out = "waitpid: " + std::string(std::strerror(errno));
      std::filesystem::remove(log, ec);
      return -1;
    }
  }

  out = readAll(log.string());
  if (out.size() > 1024) out = out.substr(out.size() - 1024);
  std::filesystem::remove(log, ec);
  return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}

// The last non-empty line, which is where forge_update puts its verdict. A menu
// has room for a sentence, not for a transcript.
std::string lastLine(const std::string& text) {
  std::size_t end = text.find_last_not_of("\r\n \t");
  if (end == std::string::npos) return {};
  const std::size_t start = text.find_last_of('\n', end);
  return text.substr(start == std::string::npos ? 0 : start + 1, end - (start == std::string::npos ? 0 : start));
}

}  // namespace

UpdateService::~UpdateService() {
  if (worker_.joinable()) worker_.join();
}

std::string UpdateService::detectAppBundle(const std::string& argv0) {
  return forge::update::enclosingAppBundle(argv0);
}

std::string UpdateService::detectRunningVersion(const std::string& argv0) {
  const std::string bundle = detectAppBundle(argv0);
  if (bundle.empty()) return {};
  return forge::update::bundleShortVersion(bundle);
}

void UpdateService::start(const std::string& running_version) {
  if (running_version.empty()) return;
  bool expected = false;
  if (!busy_.compare_exchange_strong(expected, true)) return;  // one at a time
  if (worker_.joinable()) worker_.join();

  {
    std::lock_guard<std::mutex> lk(m_);
    info_.state = ForgeFrame::UpdateState::Checking;
    info_.message = "checking for updates...";
    info_.version.clear();
  }

  worker_ = std::thread([this, running_version]() {
    ForgeFrame::UpdateInfo out;
    std::string err;

    const std::string tmp =
        (std::filesystem::temp_directory_path() / "forge_appcast_check.json").string();
    forge::update::CurlFetcher fetcher;
    fetcher.timeout_seconds = 20;  // a UI action: fail fast rather than hang a menu

    if (!fetcher.get(forge::update::kDefaultAppcastUrl, tmp, err)) {
      out.state = ForgeFrame::UpdateState::Failed;
      // One sentence, from the SAME function `forge_update` uses, so the menu and
      // the command never disagree about what went wrong. The 404 case — nothing
      // published yet, which is where this repository stands today — keeps the
      // exact wording it already had; every OTHER case used to fall through to
      // "update check failed: download failed: /usr/bin/curl exited 6: curl: (6)
      // Could not resolve host: github.com", which is a menu item quoting a
      // program the user has never heard of about a problem they can fix in one
      // click (turn the wifi on) if only anyone told them that is what it was.
      out.message = forge::update::describeFetchFailure(err);
      std::lock_guard<std::mutex> lk(m_);
      info_ = out;
      busy_ = false;
      return;
    }

    const forge::update::Manifest m = forge::update::parseManifest(readAll(tmp), err);
    std::error_code ec;
    std::filesystem::remove(tmp, ec);
    if (!m.valid) {
      out.state = ForgeFrame::UpdateState::Failed;
      out.message = "update manifest is not readable: " + err;
      std::lock_guard<std::mutex> lk(m_);
      info_ = out;
      busy_ = false;
      return;
    }

    // The channel follows what THIS BUILD IS -- an alpha follows the prerelease
    // channel -- so a shipped alpha is not a dead end. See Updater::policyFor.
    const forge::update::Plan plan =
        forge::update::decide(running_version, m, forge::update::policyFor(running_version));
    switch (plan.decision) {
      case forge::update::Decision::UpdateAvailable:
        out.state = ForgeFrame::UpdateState::Available;
        out.version = m.version;
        out.message = "Forge " + m.version + " is available";
        break;
      case forge::update::Decision::UpToDate:
        out.state = ForgeFrame::UpdateState::UpToDate;
        out.message = "Forge is up to date";
        break;
      default:
        out.state = ForgeFrame::UpdateState::Failed;
        out.message = plan.reason.empty() ? "update rejected" : plan.reason;
        break;
    }

    std::lock_guard<std::mutex> lk(m_);
    info_ = out;
    busy_ = false;
  });
}

void UpdateService::apply(const std::string& app_bundle) {
  // Only ever installs what a CHECK has already offered. Without this the menu
  // item would be a "download something" button whose behaviour depended on
  // whatever happened to be published, and the state the user was shown when
  // they clicked would not be the state that was acted on.
  if (snapshot().state != ForgeFrame::UpdateState::Available) return;

  if (app_bundle.empty()) {
    std::lock_guard<std::mutex> lk(m_);
    info_.state = ForgeFrame::UpdateState::Failed;
    info_.message = "not running from an installed Forge.app; download the release instead";
    return;
  }

  bool expected = false;
  if (!busy_.compare_exchange_strong(expected, true)) return;  // one at a time
  if (worker_.joinable()) worker_.join();

  {
    std::lock_guard<std::mutex> lk(m_);
    info_.state = ForgeFrame::UpdateState::Installing;
    info_.message = "downloading and installing...";
  }

  worker_ = std::thread([this, app_bundle]() {
    ForgeFrame::UpdateInfo out;

    // The updater that was staged BESIDE this executable. Deliberately an
    // absolute path built from the bundle we are replacing, never a PATH lookup:
    // a `forge_update` found on $PATH would be some other copy, of some other
    // version, pointed at some other repository.
    const std::string updater = app_bundle + "/Contents/MacOS/forge_update";
    std::error_code ec;
    if (!std::filesystem::is_regular_file(updater, ec)) {
      out.state = ForgeFrame::UpdateState::Failed;
      // Say WHICH half is missing. This bundle was packaged without the updater,
      // which is a packaging defect and not something the user did.
      out.message = "this build shipped without forge_update; install the new release by hand";
      std::lock_guard<std::mutex> lk(m_);
      info_ = out;
      busy_ = false;
      return;
    }

    // No --relaunch: see UpdateService.hpp. This process is still running and a
    // second Forge racing it for the same documents is worse than a restart.
    std::string log;
    const int rc = runAndCapture({updater, "apply", "--app", app_bundle}, log);
    const std::string tail = lastLine(log);

    if (rc == 0) {
      out.state = ForgeFrame::UpdateState::Installed;
      out.message = "update installed - quit and reopen Forge to finish";
    } else {
      out.state = ForgeFrame::UpdateState::Failed;
      // Every failure path inside applyUpdate leaves the INSTALLED app untouched
      // (update_gate.cpp asserts that over a tampered payload), so this is always
      // safe to report as "nothing changed".
      out.message = tail.empty() ? "update failed; the installed app is unchanged"
                                 : "update failed (" + tail + "); the installed app is unchanged";
    }

    std::lock_guard<std::mutex> lk(m_);
    info_ = out;
    busy_ = false;
  });
}

ForgeFrame::UpdateInfo UpdateService::snapshot() const {
  std::lock_guard<std::mutex> lk(m_);
  return info_;
}

}  // namespace forge::desktop
