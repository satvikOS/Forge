#pragma once

// The app-layer half of auto-update.
//
// ForgeFrame is deliberately network-free: it renders an UpdateInfo and raises a
// request, and nothing more. This owns the other half -- the background thread, the
// curl call and the policy -- so that the frame builder, and therefore every headless
// gate that drives it, can never depend on GitHub being reachable.
//
// The check is READ-ONLY. It fetches the appcast and decides; it downloads no payload
// and installs nothing. Applying an update is a separate, user-initiated act -- that
// is apply(), below.
//
// ── WHY apply() SPAWNS forge_update AND DOES NOT CALL applyUpdate() ──────────
// The app links libforge_updater, so calling applyUpdate() from this thread would
// compile and would work. It is still the wrong shape, for a reason Updater.hpp
// spells out at length: after the atomic swap, THIS process's own bundle path
// resolves into the NEW bundle, so any shader, resource or dylib subsequently
// loaded by path is a version the running code was not built against. Doing the
// swap from a SEPARATE process removes that hazard entirely rather than managing
// it -- the process doing the replacing is not the process being replaced.
//
// It also means the shipped product exercises the same binary a developer runs by
// hand (`forge_update apply --app /Applications/Forge.app`), so there is one apply
// path and not two. package_macos.sh stages that binary beside the app's own
// executable and release_dryrun.sh fails if it did not reach the bundle.
//
// apply() does NOT pass --relaunch. The updater would `open -n` the new bundle
// while this one is still running, which is two Forges and, worse, a second one
// racing the first for the same documents. The user is told to restart instead.

#include <atomic>
#include <mutex>
#include <string>
#include <thread>

#include "ForgeFrame.hpp"

namespace forge::desktop {

class UpdateService {
 public:
  UpdateService() = default;
  ~UpdateService();

  UpdateService(const UpdateService&) = delete;
  UpdateService& operator=(const UpdateService&) = delete;

  // The version this build reports, taken from the enclosing bundle's Info.plist
  // when there is one. Empty if it cannot be determined, in which case no check is
  // ever started -- a check against an unknown running version cannot order versions
  // and would offer an "update" to whatever is published.
  static std::string detectRunningVersion(const std::string& argv0);

  // Starts a check on a background thread if one is not already running.
  void start(const std::string& running_version);

  // Installs the update this service last OFFERED, on a background thread.
  // Does nothing unless a check has run and returned Available, so a caller
  // cannot turn this into a speculative download. `app_bundle` is the bundle to
  // replace -- normally the one this executable is inside; empty means there is
  // nothing installed to update and the call is refused with a message.
  void apply(const std::string& app_bundle);

  // The bundle enclosing `argv0`, or empty outside a bundle. Exposed because the
  // caller needs the same path for apply() that detectRunningVersion() read the
  // version out of, and deriving it twice by two routes is how they drift.
  static std::string detectAppBundle(const std::string& argv0);

  // A consistent snapshot for this frame. Cheap; safe to call every frame.
  ForgeFrame::UpdateInfo snapshot() const;

 private:
  mutable std::mutex m_;
  ForgeFrame::UpdateInfo info_;
  std::thread worker_;
  std::atomic<bool> busy_{false};
};

}  // namespace forge::desktop
