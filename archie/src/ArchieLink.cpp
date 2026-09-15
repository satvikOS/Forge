#include "forge/archie/ArchieLink.hpp"

#include <chrono>
#include <cstdlib>
#include <utility>

namespace forge::archie {

using forge::ui::ModelState;
using forge::ui::PlanRequest;
using forge::ui::PlanResponse;

LinkConfig configFromEnvironment(const char* value) {
  LinkConfig cfg;
  const std::string spec = value != nullptr ? std::string(value) : std::string();
  if (spec.empty()) {
    cfg.why = "looking for Archie's model on " + cfg.endpoint.host + ":" +
              std::to_string(cfg.endpoint.port);
    return cfg;
  }
  if (spec == "off" || spec == "OFF" || spec == "0") {
    cfg.off = true;
    cfg.why = "FORGE_ARCHIE_ENDPOINT=off: Archie's model is not looked for";
    return cfg;
  }

  std::string host;
  std::string port;
  if (spec.front() == '[') {
    const std::size_t close = spec.find(']');
    if (close != std::string::npos) {
      host = spec.substr(1, close - 1);
      if (close + 1 < spec.size() && spec[close + 1] == ':') port = spec.substr(close + 2);
    }
  } else {
    const std::size_t colon = spec.rfind(':');
    if (colon == std::string::npos) {
      host = spec;
    } else {
      host = spec.substr(0, colon);
      port = spec.substr(colon + 1);
    }
  }
  long portNumber = cfg.endpoint.port;
  if (!port.empty()) {
    char* end = nullptr;
    portNumber = std::strtol(port.c_str(), &end, 10);
    if (end == nullptr || *end != '\0') portNumber = 0;
  }
  if (!forge::retrieval::isLoopbackLiteral(host) || portNumber <= 0 || portNumber > 65535) {
    cfg.off = true;
    cfg.why = "FORGE_ARCHIE_ENDPOINT='" + spec +
              "' is not a loopback host:port, so Archie's model is not looked for";
    return cfg;
  }
  cfg.endpoint.host = host;
  cfg.endpoint.port = static_cast<std::uint16_t>(portNumber);
  cfg.why = "FORGE_ARCHIE_ENDPOINT: looking for Archie's model on " + host + ":" +
            std::to_string(portNumber);
  return cfg;
}

// One request in flight. Shared with its worker thread so that closing the app
// while the model is still thinking neither waits for the model nor leaves the
// worker writing into freed memory.
struct ArchieLink::Job {
  std::mutex mu;
  bool done = false;
  PlanResponse response;
  bool transportFailed = false;
};

ArchieLink::ArchieLink(LinkConfig config,
                       std::shared_ptr<forge::retrieval::HttpTransport> transport)
    : config_(std::move(config)), transport_(std::move(transport)) {
  if (!transport_) transport_ = std::make_shared<forge::retrieval::LoopbackHttpTransport>();
  if (config_.off) {
    state_ = ModelState::Off;
    return;
  }
  prober_ = std::thread([this] { proberLoop(); });
}

ArchieLink::~ArchieLink() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    stop_ = true;
  }
  cv_.notify_all();
  // Bounded: one probe's own deadline (health_timeout_ms) at most.
  if (prober_.joinable()) prober_.join();
}

void ArchieLink::publish(const Health& health) {
  std::lock_guard<std::mutex> lock(mu_);
  health_ = health;
  if (!health.reachable) {
    state_ = ModelState::NotRunning;
  } else if (!health.loaded) {
    state_ = ModelState::Loading;
  } else {
    state_ = ModelState::Ready;
  }
}

void ArchieLink::proberLoop() {
  for (;;) {
    {
      std::lock_guard<std::mutex> lock(mu_);
      if (stop_) return;
      wake_ = false;
    }
    const Health health = probeHealth(*transport_, config_.endpoint);
    publish(health);
    probes_.fetch_add(1);

    std::unique_lock<std::mutex> lock(mu_);
    const std::uint32_t waitMs =
        state_ == ModelState::Ready ? config_.recheckEveryMs : config_.probeEveryMs;
    cv_.wait_for(lock, std::chrono::milliseconds(waitMs), [this] { return stop_ || wake_; });
    if (stop_) return;
  }
}

void ArchieLink::recheckNow() {
  {
    std::lock_guard<std::mutex> lock(mu_);
    wake_ = true;
  }
  cv_.notify_all();
}

ModelState ArchieLink::state() const {
  std::lock_guard<std::mutex> lock(mu_);
  return state_;
}

Health ArchieLink::lastHealth() const {
  std::lock_guard<std::mutex> lock(mu_);
  return health_;
}

bool ArchieLink::busy() const {
  std::lock_guard<std::mutex> lock(mu_);
  return job_ != nullptr;
}

bool ArchieLink::start(const PlanRequest& request) {
  std::shared_ptr<Job> job;
  {
    std::lock_guard<std::mutex> lock(mu_);
    if (state_ != ModelState::Ready || job_ != nullptr) return false;
    job = std::make_shared<Job>();
    job_ = job;
  }
  // The planner is COPIED into the worker: a transport handle and an endpoint.
  // Nothing the worker touches belongs to this object, so it may outlive it.
  RemotePlanner planner(transport_, config_.endpoint);
  std::thread([job, planner, request]() mutable {
    PlanResponse response = planner.plan(request);
    const bool failed = !response.ok && planner.lastTransportFailed();
    std::lock_guard<std::mutex> lock(job->mu);
    job->response = std::move(response);
    job->transportFailed = failed;
    job->done = true;
  }).detach();
  return true;
}

bool ArchieLink::poll(PlanResponse& out, bool& transportFailed) {
  std::shared_ptr<Job> job;
  {
    std::lock_guard<std::mutex> lock(mu_);
    job = job_;
  }
  if (!job) return false;
  {
    std::lock_guard<std::mutex> lock(job->mu);
    if (!job->done) return false;
    out = std::move(job->response);
    transportFailed = job->transportFailed;
  }
  {
    std::lock_guard<std::mutex> lock(mu_);
    job_.reset();
    // A service that could not be reached is not running, whatever the last
    // probe said. Say so now rather than offering it again for up to ten seconds.
    if (transportFailed) state_ = ModelState::NotRunning;
  }
  if (transportFailed) recheckNow();
  return true;
}

}  // namespace forge::archie
