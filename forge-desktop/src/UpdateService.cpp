#include "UpdateService.hpp"

#include "update/Manifest.hpp"
#include "update/Updater.hpp"
#include "update/Version.hpp"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace forge::desktop {
namespace {

std::string readAll(const std::string& path) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return {};
  std::ostringstream ss;
  ss << in.rdbuf();
  return ss.str();
}

}  // namespace

UpdateService::~UpdateService() {
  if (worker_.joinable()) worker_.join();
}

std::string UpdateService::detectRunningVersion(const std::string& argv0) {
  const std::string bundle = forge::update::enclosingAppBundle(argv0);
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
      // The most common cause by far is that nothing is PUBLISHED: GitHub's
      // `latest` skips drafts and prereleases, so the URL 404s. Say so, rather
      // than showing a bare curl exit code to a user who cannot act on it.
      out.message = err.find("404") != std::string::npos
                        ? "no published release to update from yet"
                        : "update check failed: " + err;
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

ForgeFrame::UpdateInfo UpdateService::snapshot() const {
  std::lock_guard<std::mutex> lk(m_);
  return info_;
}

}  // namespace forge::desktop
