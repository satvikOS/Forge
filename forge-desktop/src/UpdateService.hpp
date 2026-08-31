#pragma once

// The app-layer half of auto-update.
//
// ForgeFrame is deliberately network-free: it renders an UpdateInfo and raises a
// request, and nothing more. This owns the other half -- the background thread, the
// curl call and the policy -- so that the frame builder, and therefore every headless
// gate that drives it, can never depend on GitHub being reachable.
//
// The check is READ-ONLY. It fetches the appcast and decides; it downloads no payload
// and installs nothing. Applying an update is a separate, user-initiated act.

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

  // A consistent snapshot for this frame. Cheap; safe to call every frame.
  ForgeFrame::UpdateInfo snapshot() const;

 private:
  mutable std::mutex m_;
  ForgeFrame::UpdateInfo info_;
  std::thread worker_;
  std::atomic<bool> busy_{false};
};

}  // namespace forge::desktop
