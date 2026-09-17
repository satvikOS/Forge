// archie/test/LoopbackSidecarStub.hpp — a REAL HTTP server on 127.0.0.1 that
// speaks archdisc-Models/tools/archie_sidecar/serve.py's contract, for gates.
//
// WHY A REAL SOCKET. The only test between the app and the sidecar used to be a
// fake HttpTransport that returned scripted structs, so the request line, the
// headers, the body bytes, Content-Length framing, the port the app looks on and
// the moment it looks were all unexercised. No prompt had ever gone
// Forge -> HTTP -> a plan -> Forge's validators -> the kernel. This binds an
// ephemeral loopback port, answers over the socket, and RECORDS what arrived, so
// a gate can assert on the far end of the wire rather than on what the client
// believes it sent.
//
// WHAT IT MIRRORS FROM serve.py, exactly:
//   GET  /health -> 200 {"ok":true,"model":..,"adapter":..,"loaded":..,"load_error":..}
//   POST /plan   -> 200 {"id":<echoed>,"ok":true,"plan":{...}}
//                -> 200 {"id":<echoed>,"ok":false,"error":"..."}
//                -> 400 {"ok":false,"error":"empty or oversized body"|"body is not JSON"}
//   anything else -> 404 {"ok":false,"error":"no such path"}
// and ONE behaviour of its ir_bridge that the app's side of the contract depends
// on: a step's literal values reach the plan only under parameter NAMES the
// request's tool schema declares. `ir_bridge.param_names(tool)` reads
// tool["schema"]; a tool sent without one yields no names, and to_steps() carries
// no values. The stub drops a recorded argument whose name the request did not
// declare for that command, so a client that stops sending schemas is caught
// here exactly as it would be by the real sidecar.
//
// It is a TEST server: one thread per connection, Connection: close, no
// keep-alive, no chunked request bodies. Nothing about it ships.
#pragma once

#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

#include <atomic>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "forge/retrieval/Json.hpp"

namespace forge::archie::test {

class LoopbackSidecarStub {
 public:
  struct Received {
    std::string method;
    std::string path;
    std::string contentType;
    std::string body;
  };

  LoopbackSidecarStub() = default;
  ~LoopbackSidecarStub() { stop(); }
  LoopbackSidecarStub(const LoopbackSidecarStub&) = delete;
  LoopbackSidecarStub& operator=(const LoopbackSidecarStub&) = delete;

  // Binds 127.0.0.1:`port` (0 = ephemeral) and starts serving.
  bool start(std::uint16_t port, std::string& why) {
    fd_ = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd_ < 0) { why = "socket()"; return false; }
    int one = 1;
    ::setsockopt(fd_, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (::bind(fd_, static_cast<sockaddr*>(static_cast<void*>(&addr)), sizeof addr) != 0) {
      why = std::string("bind(127.0.0.1:") + std::to_string(port) + "): " + std::strerror(errno);
      ::close(fd_);
      fd_ = -1;
      return false;
    }
    if (::listen(fd_, 16) != 0) { why = "listen()"; ::close(fd_); fd_ = -1; return false; }
    socklen_t len = sizeof addr;
    ::getsockname(fd_, static_cast<sockaddr*>(static_cast<void*>(&addr)), &len);
    port_ = ntohs(addr.sin_port);
    stop_ = false;
    acceptor_ = std::thread([this] { acceptLoop(); });
    return true;
  }

  void stop() {
    if (fd_ < 0 && !acceptor_.joinable()) return;
    stop_ = true;
    if (acceptor_.joinable()) acceptor_.join();
    if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
    std::vector<std::thread> workers;
    {
      std::lock_guard<std::mutex> lock(mu_);
      workers.swap(workers_);
    }
    for (std::thread& t : workers) {
      if (t.joinable()) t.join();
    }
  }

  std::uint16_t port() const noexcept { return port_; }

  void setLoaded(bool loaded) { std::lock_guard<std::mutex> l(mu_); loaded_ = loaded; }
  // The reply to POST /plan, WITHOUT the id: {"ok":true,"plan":{...}} or
  // {"ok":false,"error":"..."}. The stub prepends the id the request carried, as
  // serve.py does (`{"id": rid, ...}`).
  void setPlanReply(std::string replyWithoutId) {
    std::lock_guard<std::mutex> l(mu_);
    planReply_ = std::move(replyWithoutId);
  }
  // Echo this id instead of the one received (a reply to some other request).
  void setEchoIdOverride(std::string id) { std::lock_guard<std::mutex> l(mu_); echoOverride_ = std::move(id); }
  // How long /plan takes to answer -- a model thinking.
  void setPlanDelayMs(int ms) { std::lock_guard<std::mutex> l(mu_); planDelayMs_ = ms; }

  std::vector<Received> received() const {
    std::lock_guard<std::mutex> l(mu_);
    return received_;
  }
  std::size_t count(const std::string& method, const std::string& path) const {
    std::lock_guard<std::mutex> l(mu_);
    std::size_t n = 0;
    for (const Received& r : received_) {
      if (r.method == method && r.path == path) ++n;
    }
    return n;
  }
  // The last POST /plan body, or empty.
  std::string lastPlanBody() const {
    std::lock_guard<std::mutex> l(mu_);
    for (auto it = received_.rbegin(); it != received_.rend(); ++it) {
      if (it->method == "POST" && it->path == "/plan") return it->body;
    }
    return std::string();
  }

 private:
  void acceptLoop() {
    while (!stop_) {
      pollfd pfd{fd_, POLLIN, 0};
      const int rc = ::poll(&pfd, 1, 50);
      if (rc <= 0) continue;
      const int c = ::accept(fd_, nullptr, nullptr);
      if (c < 0) continue;
      std::lock_guard<std::mutex> lock(mu_);
      workers_.emplace_back([this, c] { serve(c); });
    }
  }

  static bool readAll(int c, std::string& head, std::string& body) {
    std::string data;
    char buf[8192];
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    std::size_t headerEnd = std::string::npos;
    std::size_t want = 0;
    for (;;) {
      if (headerEnd == std::string::npos) {
        headerEnd = data.find("\r\n\r\n");
        if (headerEnd != std::string::npos) {
          head = data.substr(0, headerEnd);
          std::string lower = head;
          for (char& ch : lower) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
          const std::size_t cl = lower.find("content-length:");
          if (cl != std::string::npos) want = std::strtoul(head.c_str() + cl + 15, nullptr, 10);
        }
      }
      if (headerEnd != std::string::npos && data.size() >= headerEnd + 4 + want) {
        body = data.substr(headerEnd + 4, want);
        return true;
      }
      if (std::chrono::steady_clock::now() > deadline) return false;
      pollfd pfd{c, POLLIN, 0};
      if (::poll(&pfd, 1, 100) <= 0) continue;
      const ssize_t n = ::recv(c, buf, sizeof buf, 0);
      if (n <= 0) return false;
      data.append(buf, static_cast<std::size_t>(n));
    }
  }

  static void reply(int c, int code, const std::string& json) {
    const char* reason = code == 200 ? "OK" : code == 400 ? "Bad Request" : "Not Found";
    std::string out = "HTTP/1.1 " + std::to_string(code) + " " + reason +
                      "\r\nServer: archie-sidecar-stub\r\nContent-Type: application/json"
                      "\r\nContent-Length: " + std::to_string(json.size()) +
                      "\r\nConnection: close\r\n\r\n" + json;
    std::size_t off = 0;
    while (off < out.size()) {
#ifdef MSG_NOSIGNAL
      const ssize_t n = ::send(c, out.data() + off, out.size() - off, MSG_NOSIGNAL);
#else
      const ssize_t n = ::send(c, out.data() + off, out.size() - off, 0);
#endif
      if (n <= 0) break;
      off += static_cast<std::size_t>(n);
    }
  }

  void serve(int c) {
#ifdef SO_NOSIGPIPE
    int one = 1;
    ::setsockopt(c, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
    std::string head, body;
    if (!readAll(c, head, body)) { ::close(c); return; }
    Received r;
    const std::size_t sp1 = head.find(' ');
    const std::size_t sp2 = head.find(' ', sp1 + 1);
    if (sp1 != std::string::npos && sp2 != std::string::npos) {
      r.method = head.substr(0, sp1);
      r.path = head.substr(sp1 + 1, sp2 - sp1 - 1);
    }
    {
      std::string lower = head;
      for (char& ch : lower) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
      const std::size_t ct = lower.find("content-type:");
      if (ct != std::string::npos) {
        std::size_t s = ct + 13;
        while (s < head.size() && head[s] == ' ') ++s;
        r.contentType = head.substr(s, head.find("\r\n", s) - s);
      }
    }
    r.body = body;
    bool loaded = false;
    std::string planReply, echoOverride;
    int delay = 0;
    {
      std::lock_guard<std::mutex> lock(mu_);
      received_.push_back(r);
      loaded = loaded_;
      planReply = planReply_;
      echoOverride = echoOverride_;
      delay = planDelayMs_;
    }

    if (r.method == "GET" && r.path == "/health") {
      reply(c, 200, std::string("{\"ok\": true, \"model\": \"models/qwen3-vl-30b-a3b-4bit\", "
                                "\"adapter\": \"adapters/archie-30b-knowing-v1\", \"loaded\": ") +
                        (loaded ? "true" : "false") + ", \"load_error\": null, \"experts\": null}");
    } else if (r.method == "POST" && r.path == "/plan") {
      namespace json = forge::retrieval::json;
      json::Value req;
      std::string perr;
      if (body.empty() || body.size() > 4u * 1024u * 1024u) {
        reply(c, 400, "{\"ok\": false, \"error\": \"empty or oversized body\"}");
      } else if (!json::parse(body, req, perr)) {
        reply(c, 400, "{\"ok\": false, \"error\": \"body is not JSON\"}");
      } else {
        if (delay > 0) std::this_thread::sleep_for(std::chrono::milliseconds(delay));
        std::string rid = echoOverride;
        if (rid.empty()) {
          const json::Value& id = req.at("id");
          rid = id.isNull() ? std::string("\"\"") : id.dump();
        }
        std::string rest = bridgeFilter(req, planReply);
        if (rest.size() < 2 || rest.front() != '{') {
          rest = "{\"ok\": false, \"error\": \"the stub has no reply recorded\"}";
        }
        reply(c, 200, "{\"id\": " + rid + ", " + rest.substr(1));
      }
    } else {
      reply(c, 404, "{\"ok\": false, \"error\": \"no such path\"}");
    }
    ::close(c);
  }

  // ir_bridge's one load-bearing behaviour: a value reaches a step only under a
  // name the REQUEST's schema for that command declares.
  static std::string bridgeFilter(const forge::retrieval::json::Value& req,
                                  const std::string& replyWithoutId) {
    namespace json = forge::retrieval::json;
    json::Value rep;
    std::string perr;
    if (!json::parse(replyWithoutId, rep, perr) || !rep.at("ok").boolean(false)) {
      return replyWithoutId;
    }
    std::map<std::string, json::Value> root = rep.fields();
    std::map<std::string, json::Value> plan = rep.at("plan").fields();
    std::vector<json::Value> steps;
    for (const json::Value& step : rep.at("plan").at("steps").items()) {
      const std::string id = step.stringField("commandId", "");
      std::set<std::string> names;
      for (const json::Value& tool : req.at("tools").items()) {
        if (tool.stringField("id", "") != id) continue;
        for (const json::Value& p : tool.at("schema").items()) {
          if (!p.stringField("name", "").empty()) names.insert(p.stringField("name", ""));
        }
      }
      std::map<std::string, json::Value> s = step.fields();
      std::vector<json::Value> args;
      for (const json::Value& a : step.at("args").items()) {
        if (names.count(a.stringField("name", "")) != 0) args.push_back(a);
      }
      s["args"] = json::Value::makeArray(std::move(args));
      steps.push_back(json::Value::makeObject(std::move(s)));
    }
    plan["steps"] = json::Value::makeArray(std::move(steps));
    root["plan"] = json::Value::makeObject(std::move(plan));
    return json::Value::makeObject(std::move(root)).dump();
  }

  int fd_ = -1;
  std::uint16_t port_ = 0;
  std::atomic<bool> stop_{false};
  std::thread acceptor_;
  mutable std::mutex mu_;
  std::vector<std::thread> workers_;
  std::vector<Received> received_;
  bool loaded_ = true;
  std::string planReply_ = "{\"ok\": false, \"error\": \"model not loaded yet\"}";
  std::string echoOverride_;
  int planDelayMs_ = 0;
};

}  // namespace forge::archie::test
