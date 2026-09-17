// forge::archie::ArchieLink — the application's connection to Archie's model.
//
// ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
// The Archie a user reached in Forge.app was forge::ui::LocalPlanner, a verb
// matcher that says of itself "no network, no model". The model-backed planner
// was compiled into the app and installed ONLY when FORGE_ARCHIE_ENDPOINT was
// set in the environment -- which an app launched from the Finder or the Dock
// never has. So a person typing a sentence into the CoPilot panel was never
// talking to the model, and the panel's header said "Working offline, on this
// computer" whichever planner answered.
//
// And when it WAS installed, the plan call ran synchronously inside the frame:
// a 30B model thinking for 21 s froze the window for 21 s.
//
// ── WHAT THIS DOES ──────────────────────────────────────────────────────────
//   * DISCOVERS the model service on its loopback port by asking GET /health,
//     at startup and every few seconds after, on its own thread with a 1 s
//     deadline per probe. When the service says its model is loaded, Archie IS
//     the model. When it stops answering, the panel says so and the built-in
//     commands answer, and when it comes back the next probe notices.
//   * ASKS off the UI thread. start() returns at once; poll() hands the answer
//     back on the frame that finds it ready.
//   * FORGE_ARCHIE_ENDPOINT stays as an override -- another loopback port, or
//     `off` -- and a non-loopback value is refused, never followed.
//
// Nothing here can reach off the machine: every request goes through
// LoopbackHttpTransport, which refuses any host that is not a loopback literal.
#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "forge/archie/RemotePlanner.hpp"
#include "forge/retrieval/HttpTransport.hpp"
#include "forge/ui/ArchieCopilot.hpp"

namespace forge::archie {

struct LinkConfig {
  Endpoint endpoint;               // where the model service is looked for
  bool off = false;                // never look (the user said `off`, or the override was refused)
  std::string why;                 // how this config was chosen, for the startup log
  std::uint32_t probeEveryMs = 3000;     // while the model is not ready
  std::uint32_t recheckEveryMs = 10000;  // while it is
};

// The config for a value of FORGE_ARCHIE_ENDPOINT (nullptr when unset).
//   unset / ""          -> look on 127.0.0.1:8731, serve.py's default port
//   "off"               -> never look; the built-in commands answer
//   "127.0.0.1:9000"    -> look there instead
//   anything else       -> refused: off, with the reason in `why` -- a name
//                          ("localhost"), a remote address, IPv6 (the transport
//                          is IPv4-only), a bad port
LinkConfig configFromEnvironment(const char* value);

class ArchieLink final : public forge::ui::PlannerService {
 public:
  explicit ArchieLink(LinkConfig config,
                      std::shared_ptr<forge::retrieval::HttpTransport> transport = nullptr);
  ~ArchieLink() override;
  ArchieLink(const ArchieLink&) = delete;
  ArchieLink& operator=(const ArchieLink&) = delete;

  // forge::ui::PlannerService -- none of these waits on the network.
  forge::ui::ModelState state() const override;
  bool start(const forge::ui::PlanRequest& request) override;
  bool poll(forge::ui::PlanResponse& out, bool& transportFailed) override;
  bool busy() const override;

  const LinkConfig& config() const noexcept { return config_; }
  // The most recent health reading, and how many probes have completed. For the
  // startup log and for the gate; the panel reads state() only.
  Health lastHealth() const;
  std::uint64_t probesCompleted() const noexcept { return probes_.load(); }
  // Probe again now rather than at the next interval. Called after a request
  // could not reach the service, so the panel stops claiming a model that is gone.
  void recheckNow();

 private:
  struct Job;
  void proberLoop();
  void publish(const Health& health);

  LinkConfig config_;
  std::shared_ptr<forge::retrieval::HttpTransport> transport_;

  mutable std::mutex mu_;
  std::condition_variable cv_;
  bool stop_ = false;
  bool wake_ = false;
  Health health_;
  forge::ui::ModelState state_ = forge::ui::ModelState::NotRunning;
  std::shared_ptr<Job> job_;
  std::atomic<std::uint64_t> probes_{0};
  std::thread prober_;
};

}  // namespace forge::archie
