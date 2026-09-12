// camera_stability_gate.cpp — THE CAMERA IS NOT A FUNCTION OF THE VERTEX BUFFER.
//
// THE DEFECT, MEASURED ON THE TREE BEFORE THIS GATE EXISTED.
//
//   ForgeFrame::syncSceneToDocument() raises `geometryDirty_` after EVERY
//   rebuild, including one the kernel refused -- correctly, because it means
//   "the host must re-upload the vertex stream". main.cpp's frame loop then hung
//   a SECOND, unrelated duty off that same flag:
//
//       if (req.geometryDirty) {
//         vkDeviceWaitIdle(g_device);
//         viewport.uploadVertices(...);
//         float c[3] = {0,0,0};
//         scene.bounds().centre(c);
//         frame.camera().frame(c, scene.bounds().radius());   // <- this
//       }
//
//   So the camera followed the vertex buffer. Orbit, zoom in to distance
//   108.87, pan the target to (-1.457, -3.397, 12.106), then change one fillet
//   radius, and the target snapped back to (0.000, 0.000, 10.000) with the
//   distance back at 144.90. Those are measured numbers from a probe that
//   applied the loop's own rule, not an estimate.
//
//   ITERATING A DIMENSION IS THE CORE CAD LOOP. Every Apply cost a re-orbit and
//   a re-zoom. And it happened on a FAILED rebuild too -- where the screen had
//   not changed at all, the previous body was still on it, and there was by
//   construction nothing new to look at.
//
//   Camera::frame() writes target_ and distance_ and leaves azimuth_/elevation_
//   alone, so the visible loss is PAN AND ZOOM, not the orbit. That distinction
//   matters here: an assertion that only compared the orbit angles would have
//   passed against the defect, which is why every check below compares the whole
//   camera -- target, distance, azimuth AND elevation.
//
// WHAT THE FIX IS. Framing is a DOCUMENT event, not a mesh event, so the
// decision moved to the object that can tell those apart. ForgeFrame frames its
// own camera on exactly three occasions -- the first body the window shows, a
// document opened or replaced, a New -- and `view.fit` remains the user's own
// way to ask for it at any other time. The host loop no longer touches the
// camera at all.
//
// THE SECOND DEFECT, AND THE HOLE THAT HID IT. The three occasions raise a
// latch, refitCameraPending_, and syncSceneToDocument() consumes it. But that
// function returns EARLY when the program it is handed is identical to the one
// already built -- which is exactly what re-opening the open file, or File > New
// on an untouched starter part, produces -- and the early exit ran before the
// latch was consumed. So the framing an open owed the user never happened, the
// request stayed armed, and the user's NEXT PLAIN EDIT collected it: the
// original defect, alive on the one path that skipped the rule written to stop
// it. MEASURED: open, open the same file again, nudge one dimension ->
// target (-1.099, 11.116, 51.765) -> (0, 0, 45), distance 189.48 -> 813.18.
//
// THIS GATE COULD NOT SEE IT, and that is the more serious half. Every stability
// check it made was made in the PRISTINE STARTUP STATE, where the latch is
// already clear -- so it passed whether the latch was ever consumed or not.
// MEASURED: deleting the single line `refitCameraPending_ = false;` -- arm once,
// never consume -- left this gate at 33 checks / 0 failures and exit 0 while
// breaking every rebuild after an open. A gate that stays green when the line it
// exists to protect is deleted is not a gate. Checks 7 and 8 make the claim
// again on the far side of a document event, which is the only state in which
// the latch is ever set; that same deletion now costs 7 checks.
//
// THE THIRD DEFECT, AND IT IS THE SAME SHAPE AS THE SECOND. The checks written
// for the latch all reached it through documentOpen() or documentReset().
// NOTHING drove documentNew(). MEASURED: deleting `refitCameraPending_ = true;`
// from ForgeFrame::documentNew() -- File > New never asks to be framed -- left
// this gate at 58 checks / 0 failures and exit 0. The consume side had been
// closed and the ARM side left open, one function away. Check 9 closes it.
//
// WHAT THIS GATE ASSERTS, headless -- no window, no swapchain, no GPU:
//
//   0  THE HOST'S REACTION, RUN. Not read: hostViewportActions() decides what the
//      host does about a ViewportRequest, main.cpp executes what it returns, and
//      this gate drives all THIRTY-TWO reachable request shapes through that
//      shipped function with a live camera parked in front of it. Plus the
//      structural belt checks over main.cpp, each labelled (structural).
//   1  the first build frames, exactly once
//   2  a SUCCESSFUL rebuild that changes the bounds leaves the camera untouched,
//      and still asks the host to re-upload
//   3  a FAILED rebuild leaves the camera untouched
//   4  `view.fit` through the ONE registry still frames the part
//   5  opening a document DOES re-frame, onto the new part's size
//   6  emptying and refilling a document (Import STEP, Load Sample) re-frames
//      too -- the empty build in the middle does NOT swallow the request, and it
//      does not empty the NAME of the body still on screen either
//   7  a plain edit AFTER AN OPEN leaves the camera untouched  <- the hole above
//   8  an open whose program is IDENTICAL to the one loaded still frames, the
//      edit that follows it does not, and the application does not then believe
//      itself mid-rebuild                                      <- the defect above
//   9  File > New frames -- twice, so the second one takes the identical-program
//      path as well -- and the edit after it does not     <- the ARM-side hole
//  10  a window that opens on a KERNEL FAILURE frames nothing and counts
//      nothing, goes on drawing frames without consuming the request it is
//      holding, and frames the first real body it is given, exactly once
//
// Checks 2, 4, 5, 6 and 9 are all needed together. Fixing 2 by never framing at
// all would break 4, 5, 6 and 9, and each of those is a way for a part to be
// invisible when a window opens on it.
//
// PROVING IT CAN FAIL. `--mutate <n>`:
//   1  re-frame on every re-upload, the removed host rule verbatim -> 5 red
//   2  re-frame after the FAILED rebuild only                      -> 1 red
//   3  `view.fit` is never dispatched -- the counter-nobody-reads
//      defect applyPendingFit() was written for                    -> 2 red
//   4  reach the new document with a bare documentChanged() instead
//      of file.open                                               -> 3 red
//   5  refill the document WITHOUT emptying it first, so no reset
//      ever asks for the framing an import needs                  -> 3 red
//   6  re-derive the ALREADY OPEN document without saying a document
//      event happened, so nothing asks for the framing an open owes -> 3 red
//
// AND AGAINST THE PRODUCTION CODE, WHICH IS THE PART THAT MATTERS. Every line
// this gate's own commit adds or changes in ForgeFrame.cpp, ForgeFrame.hpp and
// main.cpp was broken one at a time, rebuilt, and run against this gate: 35
// mutations, 34 red. The one that stays green is named in the commit message --
// `bool refitCameraPending_ = false;`, whose in-class initialiser the constructor
// overwrites unconditionally, so nothing can observe it.
#include "../src/ForgeFrame.hpp"
#include "../src/KernelScene.hpp"
#include "../src/PartFile.hpp"

#include "forge/ui/ForgeShell.hpp"

#include "imgui.h"

#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include <unistd.h>  // getpid, for a temp path no concurrent run can be holding

namespace {

int g_checks = 0;
int g_failures = 0;
int g_mutation = 0;

void ck(const char* what, bool ok, const std::string& detail = "") {
  ++g_checks;
  if (ok) {
    std::printf("    ok   %s\n", what);
  } else {
    ++g_failures;
    std::printf("    FAIL %s%s%s\n", what, detail.empty() ? "" : "  -> ", detail.c_str());
  }
}

struct HeadlessImGui {
  HeadlessImGui(float w, float h) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.DisplaySize = ImVec2(w, h);
    io.DeltaTime = 1.0f / 60.0f;
    io.IniFilename = nullptr;
    io.LogFilename = nullptr;
    io.BackendRendererName = "camera_stability_gate_null";
    io.Fonts->AddFontDefault();
    unsigned char* pixels = nullptr;
    int tw = 0, th = 0;
    io.Fonts->GetTexDataAsRGBA32(&pixels, &tw, &th);
    io.Fonts->SetTexID(static_cast<ImTextureID>(1));
    forge::desktop::applyForgeStyle(1.0f);
  }
  ~HeadlessImGui() { ImGui::DestroyContext(); }
};

// ── THE HOST'S REACTION, RUN ────────────────────────────────────────────────
// How many times the host was told to do each thing. Counted, so "the host did
// not move the camera" can never be satisfied by a host that did nothing at all.
struct HostRun {
  int resizes = 0;
  int waits = 0;
  int uploads = 0;
};
HostRun g_host;

// ── MUTATION 7 NEEDS THE SHELL, so the host can re-frame the camera the way the
//    APPLICATION does rather than by touching Camera directly. See the mutation
//    note in applyHostActions for why that distinction is the whole point.
forge::ui::ForgeShell* g_shell = nullptr;

// Execute the shipped decision the way main.cpp executes it -- the resize, the
// device drain, the vertex upload -- and NOTHING ELSE. There is no fourth line
// here because there is no fourth action in HostViewportActions.
//
// The mutations put the removed second duty back, at the one place the host
// could ever have hung it: off the re-upload event.
void applyHostActions(const forge::desktop::HostViewportActions& act,
                      forge::desktop::ForgeFrame& frame,
                      const forge::desktop::KernelScene& scene, HostRun& log) {
  if (act.resize) ++log.resizes;
  if (act.waitDeviceIdle) ++log.waits;
  if (act.uploadVertices) {
    ++log.uploads;
    // MUTATION 1 -- the removed host rule, verbatim: the camera follows the
    // vertex buffer. This is the original defect.
    // MUTATION 2 -- the same rule, but only after a rebuild the kernel refused,
    // where the screen has not changed at all.
    if (g_mutation == 1 || (g_mutation == 2 && !frame.rebuildError().empty())) {
      float c[3] = {0.0f, 0.0f, 0.0f};
      scene.bounds().centre(c);
      frame.camera().frame(c, scene.bounds().radius());
    }
    // MUTATION 7 -- THE SAME DEFECT THROUGH THE OTHER DOOR, and it is here
    // because a reviewer of this gate found it and the gate STAYED GREEN.
    //
    // Mutations 1 and 2 reach for Camera directly. This one asks the
    // APPLICATION to re-frame, `view.fit`, which is a command a user is allowed
    // to run -- so nothing about it looks wrong from the host's side. The reason
    // it slipped past is structural: view.fit lands through fitCount and
    // applyPendingFit(), which move the camera WITHOUT touching cameraRefits_.
    // Every "did a document event re-frame the camera" check in this file reads
    // cameraRefits_, so the counter stays at 1 while the camera is thrown from
    // the user's view back onto the part. The CamState comparisons are what must
    // catch this, and whether they do is the question this mutation asks.
    if (g_mutation == 7 && g_shell != nullptr) {
      g_shell->run("view.fit");
    }
  }
}

// One application frame, and then THE HOST REACTING TO IT, exactly as main.cpp's
// loop does. Every camera assertion in this gate is therefore made with the
// host's real response in the loop, and not on a frame the host never saw.
void step(forge::desktop::ForgeFrame& frame, const forge::desktop::KernelScene& scene) {
  ImGui::NewFrame();
  frame.build(0, 1.0f);
  ImGui::Render();
  applyHostActions(forge::desktop::hostViewportActions(frame.viewport()), frame, scene, g_host);
}

// THE WHOLE CAMERA, not a summary of it. distance() alone would pass a defect
// that only moved the target; azimuth/elevation alone would pass the one this
// gate exists for, because Camera::frame() does not touch them.
struct CamState {
  float target[3] = {0.0f, 0.0f, 0.0f};
  float distance = 0.0f;
  float azimuth = 0.0f;
  float elevation = 0.0f;

  // EXACT equality, deliberately. "Did anything move the camera?" is a question
  // about whether an assignment ran, not about how far it went, and a tolerance
  // here would let a body that re-frames to nearly the same place slip through.
  bool operator==(const CamState& o) const {
    return target[0] == o.target[0] && target[1] == o.target[1] &&
           target[2] == o.target[2] && distance == o.distance &&
           azimuth == o.azimuth && elevation == o.elevation;
  }
  std::string str() const {
    char buf[192];
    std::snprintf(buf, sizeof(buf), "target=(%.4f, %.4f, %.4f) d=%.4f az=%.4f el=%.4f",
                  static_cast<double>(target[0]), static_cast<double>(target[1]),
                  static_cast<double>(target[2]), static_cast<double>(distance),
                  static_cast<double>(azimuth), static_cast<double>(elevation));
    return buf;
  }
};

CamState snap(const forge::desktop::Camera& c) {
  CamState s;
  for (int i = 0; i < 3; ++i) s.target[i] = c.target()[i];
  s.distance = c.distance();
  s.azimuth = c.azimuth();
  s.elevation = c.elevation();
  return s;
}

// What the PRODUCTION Camera produces when it frames this scene's bounds. The
// reference is computed by the same class the application uses rather than
// written down, so a change to the 15% margin or the fov cannot make this gate
// disagree with the app while both are correct.
CamState framedOn(const forge::desktop::KernelScene& scene, float aspect) {
  forge::desktop::Camera ref;
  ref.setAspect(aspect);
  float c[3] = {0.0f, 0.0f, 0.0f};
  scene.bounds().centre(c);
  ref.frame(c, scene.bounds().radius());
  return snap(ref);
}

bool framesSameSphere(const CamState& live, const CamState& ref) {
  for (int i = 0; i < 3; ++i) {
    if (std::fabs(live.target[i] - ref.target[i]) > 1e-3f) return false;
  }
  return std::fabs(live.distance - ref.distance) <= 1e-3f;
}

// A PATH NO OTHER RUN OF THIS BINARY CAN BE HOLDING.
//
// This was a FIXED name -- $TMPDIR/forge_camera_stability_big.fpart -- and the
// same binary is registered with ctest SIX times (the gate plus five WILL_FAIL
// mutations), so `ctest -j` runs several of them at once against that one path.
// They raced: one run's cleanup deleted the file another had just written, and
// savePartFile then reported "cannot replace ... : No such file or directory".
// MEASURED: eight concurrent runs, one RED -- a flake that lands on whichever run
// loses, which is the worst kind.
//
// The pid separates concurrent processes and the sequence number separates the
// files within one, so no two writers ever meet.
int g_tempSeq = 0;
std::string tempPath(const char* leaf) {
  const char* tmp = std::getenv("TMPDIR");
  std::string dir = (tmp != nullptr && tmp[0] != 0) ? std::string(tmp) : std::string("/tmp");
  if (!dir.empty() && dir.back() == '/') dir.pop_back();
  return dir + "/forge_camera_stability_" + std::to_string(static_cast<long>(getpid())) + "_" +
         std::to_string(++g_tempSeq) + "_" + leaf;
}

// A file in forge-desktop/src, found from THIS file's own compile-time path.
// The host is not linkable here -- it needs SDL2 and Vulkan -- so its rule is
// read rather than run. That is the honest instrument for the claim "the host
// does not do X": anything else would be asserting against a copy.
std::string srcPath(const char* leaf) {
  std::string self = __FILE__;
  const std::size_t slash = self.find_last_of('/');
  if (slash == std::string::npos) return std::string();
  return self.substr(0, slash) + "/../src/" + leaf;
}

bool readFile(const std::string& path, std::string& out) {
  std::FILE* f = std::fopen(path.c_str(), "rb");
  if (f == nullptr) return false;
  char buf[8192];
  std::size_t n = 0;
  out.clear();
  while ((n = std::fread(buf, 1, sizeof(buf), f)) > 0) out.append(buf, n);
  std::fclose(f);
  return true;
}

// The whole source line `needle` first appears on, so a structural check can say
// WHAT the host does with something and not merely that it mentions it.
std::string lineWith(const std::string& hay, const std::string& needle) {
  const std::size_t at = hay.find(needle);
  if (at == std::string::npos) return std::string();
  const std::size_t from = hay.rfind('\n', at);
  const std::size_t to = hay.find('\n', at);
  const std::size_t b = (from == std::string::npos) ? 0 : from + 1;
  return hay.substr(b, (to == std::string::npos ? hay.size() : to) - b);
}

std::size_t countOf(const std::string& hay, const std::string& needle) {
  std::size_t n = 0;
  for (std::size_t at = hay.find(needle); at != std::string::npos;
       at = hay.find(needle, at + needle.size())) {
    ++n;
  }
  return n;
}

// The source with its `//` comments removed. EVERY structural check below runs
// on this and not on the file, because a check that reads comments is not
// reading the program: MEASURED -- deleting main.cpp's call to
// hostViewportActions() and deciding inline again left "the host routes its
// reaction through that decision" GREEN, because the sentence above the code
// that explains the call still contained the words the check looked for.
//
// It is a line-wise strip, so a `//` inside a string literal would truncate that
// line. main.cpp has none; if it ever does, this reads as a false RED on a check
// that names the line it failed on, which is the safe direction.
std::string codeOnly(const std::string& src) {
  std::string out;
  out.reserve(src.size());
  std::size_t pos = 0;
  while (pos <= src.size()) {
    const std::size_t nl = src.find('\n', pos);
    const std::size_t end = (nl == std::string::npos) ? src.size() : nl;
    const std::string line = src.substr(pos, end - pos);
    const std::size_t slashes = line.find("//");
    out += (slashes == std::string::npos) ? line : line.substr(0, slashes);
    out += '\n';
    if (nl == std::string::npos) break;
    pos = nl + 1;
  }
  return out;
}

std::string trimmed(const std::string& in) {
  std::size_t b = 0, e = in.size();
  while (b < e && (in[b] == ' ' || in[b] == '\t')) ++b;
  while (e > b && (in[e - 1] == ' ' || in[e - 1] == '\t' || in[e - 1] == '\r')) --e;
  return in.substr(b, e - b);
}

// Every line inside `struct NAME { ... };`, trimmed, comments and blanks dropped.
std::vector<std::string> structBody(const std::string& hdr, const std::string& name) {
  std::vector<std::string> out;
  const std::size_t at = hdr.find("struct " + name + " {");
  if (at == std::string::npos) return out;
  std::size_t pos = hdr.find('\n', at);
  while (pos != std::string::npos) {
    ++pos;
    const std::size_t nl = hdr.find('\n', pos);
    const std::string line =
        trimmed(hdr.substr(pos, (nl == std::string::npos ? hdr.size() : nl) - pos));
    if (line == "};") break;
    if (!line.empty() && line.rfind("//", 0) != 0) out.push_back(line);
    pos = nl;
  }
  return out;
}

// Every member function of Camera that is NOT const -- READ FROM Camera.hpp
// rather than listed here, so a mutator added to that class is covered by the
// check below on the day it is added and not on the day somebody remembers it.
// Deliberately over-inclusive: a static helper, and a const declaration whose
// signature wraps onto a second line, are both counted as mutators. The host has
// no business calling any method on the camera at all, so over-inclusion costs
// nothing and under-inclusion is the hole.
std::vector<std::string> cameraMethodNames(const std::string& hdr) {
  std::vector<std::string> out;
  const std::size_t at = hdr.find("class Camera {");
  if (at == std::string::npos) return out;
  std::size_t pos = hdr.find('\n', at);
  while (pos != std::string::npos) {
    ++pos;
    const std::size_t nl = hdr.find('\n', pos);
    const std::string line =
        trimmed(hdr.substr(pos, (nl == std::string::npos ? hdr.size() : nl) - pos));
    if (line == "};") break;
    pos = nl;
    if (line.rfind("//", 0) == 0) continue;
    if (line.find(") const") != std::string::npos) continue;
    const std::size_t v = line.find("void ");
    if (v == std::string::npos) continue;
    const std::size_t paren = line.find('(', v);
    if (paren == std::string::npos || paren <= v + 5) continue;
    const std::string nm = trimmed(line.substr(v + 5, paren - (v + 5)));
    if (nm.empty() || nm.find(' ') != std::string::npos) continue;
    out.push_back(nm);
  }
  return out;
}

}  // namespace

int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    if (std::strcmp(argv[i], "--mutate") == 0 && i + 1 < argc) g_mutation = std::atoi(argv[++i]);
  }
  if (g_mutation != 0) std::printf("[camera] MUTATION %d ACTIVE\n", g_mutation);
  std::printf("== the camera survives a rebuild ==\n");

  // ── the application, headless ────────────────────────────────────────────
  forge::desktop::KernelScene scene;
  if (!scene.build()) {
    std::printf("[camera] cannot continue without geometry: %s\n", scene.error().c_str());
    return 1;
  }
  HeadlessImGui imgui(1600.0f, 1000.0f);
  forge::ui::ForgeShell shell;
  g_shell = &shell;
  forge::desktop::ForgeFrame frame(shell, scene);
  frame.wirePartCommands();
  step(frame, scene);

  // ── 0. THE HOST'S REACTION, RUN — NOT READ ───────────────────────────────
  //
  // THE CHECK THIS REPLACES WAS A TEXT SEARCH: countOf(main.cpp, "camera().frame(")
  // == 0. It is not a measurement and it is defeated by one line --
  // `Camera& cam = frame.camera(); cam.frame(...)` restores the entire defect and
  // leaves the count at zero. MEASURED: with exactly that in main.cpp's
  // geometryDirty branch this gate stayed GREEN and forge_desktop compiled and
  // linked.
  //
  // The host's DECISION now lives in hostViewportActions() -- GPU-free, no camera
  // in its arguments, its return type or its scope -- and main.cpp executes what
  // it returns. So the gate can RUN it. Every one of the THIRTY-TWO reachable
  // request shapes is driven through the shipped function and its actions applied
  // to the live application, with the camera parked, and the camera is MEASURED
  // after each.
  std::printf("\n  0. the HOST's reaction to a viewport request, run against a live camera\n");
  {
    const CamState parked = snap(frame.camera());
    int shapes = 0, uploadShapes = 0, waitShapes = 0, resizeShapes = 0, moved = 0;
    for (int bits = 0; bits < 32; ++bits) {
      forge::desktop::ViewportRequest req;
      req.visible = (bits & 1) != 0;
      req.geometryDirty = (bits & 2) != 0;
      req.visibilityDirty = (bits & 4) != 0;
      req.selectionDirty = (bits & 8) != 0;
      // BIT 4 IS WHETHER THE PANEL HAS A SIZE AT ALL, and it is here because
      // without it one half of the resize decision could not be measured: handing
      // every shape 1600x1000 makes `req.width > 0 && req.height > 0` true in all
      // of them, so deleting that half left the count identical and this gate
      // green. A zero-sized 3D panel is reachable -- it is what a collapsed or
      // freshly docked panel reports on the frame before it is laid out.
      const bool sized = (bits & 16) != 0;
      req.width = sized ? 1600 : 0;
      req.height = sized ? 1000 : 0;
      const forge::desktop::HostViewportActions act = forge::desktop::hostViewportActions(req);
      ++shapes;
      if (act.uploadVertices) ++uploadShapes;
      if (act.waitDeviceIdle) ++waitShapes;
      if (act.resize) ++resizeShapes;
      HostRun log;
      applyHostActions(act, frame, scene, log);
      if (!(snap(frame.camera()) == parked)) ++moved;
    }
    // NON-VACUITY FIRST, with exact numbers. A seam that decided nothing would
    // move no camera either, and would pass the check below it for the wrong
    // reason. upload fires on geometry|visibility|selection (28 of 32), the
    // device drain on geometry|visibility (24), the resize on a visible panel
    // that has a real size (8).
    ck("the host's decision really fires: 28 of 32 request shapes re-upload",
       shapes == 32 && uploadShapes == 28, std::to_string(uploadShapes) + " of " +
           std::to_string(shapes));
    ck("  ...24 of them drain the device first", waitShapes == 24,
       std::to_string(waitShapes));
    ck("  ...8 of them resize the 3D target", resizeShapes == 8,
       std::to_string(resizeShapes));
    // WHAT THIS CHECK CAN AND CANNOT FAIL FOR, said where it is made. It is
    // labelled (harness) because hostViewportActions() takes a const
    // ViewportRequest& and returns three bools: it CANNOT move a camera, so no
    // change to shipped code makes this line red. What it guards is the gate's
    // OWN runner -- that mutations 1 and 2 are off when they were not asked for,
    // which is what keeps their red-then-green meaningful. The claim about
    // shipped code that this used to pretend to be is the one below it.
    ck("(harness) the gate's own runner moved the camera in none of the 32", moved == 0,
       std::to_string(moved) + " request shape(s) moved the camera with no mutation "
       "requested, so the sweep's own harness is what is broken");

    // ── THE SHIPPED CLAIM THE LINE ABOVE CANNOT MAKE ─────────────────────────
    //
    // applyHostActions() above has one branch per member of HostViewportActions.
    // If the seam grows a FOURTH duty, main.cpp executes it and this gate does
    // not -- so a camera duty added to the struct leaves every check in this
    // block green while the defect is back in the shipped binary. MEASURED,
    // against the code as it stood: adding `bool refitCamera` to the struct and
    // setting it on every geometryDirty left this gate at 58 checks / 0 failures
    // / exit 0.
    //
    // So the gate asserts that the action set IS the set it executes. Read from
    // the header rather than agreed by convention, because the two drifting
    // apart is the whole failure.
    const std::string framePath = srcPath("ForgeFrame.hpp");
    std::string frameSrc;
    const bool frameRead = !framePath.empty() && readFile(framePath, frameSrc);
    ck("(structural) forge-desktop/src/ForgeFrame.hpp is readable", frameRead, framePath);
    if (frameRead) {
      const std::vector<std::string> members = structBody(frameSrc, "HostViewportActions");
      std::string spelled;
      bool allBool = !members.empty();
      for (const std::string& m : members) {
        if (m.rfind("bool ", 0) != 0) {
          allBool = false;
          continue;
        }
        const std::size_t e = m.find_first_of(" =;", 5);
        spelled += (spelled.empty() ? "" : ",") + m.substr(5, e - 5);
      }
      ck("the seam carries EXACTLY the three actions this gate executes",
         allBool && spelled == "resize,waitDeviceIdle,uploadVertices",
         "HostViewportActions declares [" + spelled + "]" +
             (allBool ? "" : " plus a member that is not a bool") +
             " -- applyHostActions() in this gate executes resize, waitDeviceIdle and "
             "uploadVertices and nothing else, so anything beyond those is a duty the "
             "host performs and this gate never runs");
    }

    // The claims here that READ the host instead of running it, and they are
    // claims about ROUTING, not about behaviour: that main.cpp executes the
    // decision above rather than deciding for itself again. Stated as what they
    // are -- forge_desktop links SDL2, Vulkan and a display, so this file cannot
    // be linked into a headless gate and its text is the only instrument left.
    const std::string path = srcPath("main.cpp");
    std::string file;
    const bool read = !path.empty() && readFile(path, file);
    const std::string src = codeOnly(file);
    // An unreadable file is a RED, never a skip: a check that quietly does not
    // run reads exactly like a check that passed.
    ck("(structural) forge-desktop/src/main.cpp is readable", read, path);
    if (read) {
      ck("(structural) the host routes its viewport reaction through that decision",
         countOf(src, "hostViewportActions(") >= 1,
         "main.cpp does not call hostViewportActions() -- it is deciding inline "
         "again, and everything above this line is then measuring code the host "
         "no longer runs");
      // AND IT CONSUMES EVERY ACTION THE DECISION RETURNS. Routing alone is not
      // enough: a host that calls the function and then ignores act.uploadVertices
      // leaves the rebuild's new triangles off the GPU, and nothing above this
      // line can see it -- this gate runs the DECISION, and the host's execution
      // of it links SDL2, Vulkan and a display. The member names come from the
      // header, so an action added there must be consumed here to stay green.
      if (frameRead) {
        std::string ignored;
        for (const std::string& m : structBody(frameSrc, "HostViewportActions")) {
          if (m.rfind("bool ", 0) != 0) continue;
          const std::size_t e = m.find_first_of(" =;", 5);
          const std::string name = m.substr(5, e - 5);
          if (countOf(src, "act." + name) == 0) ignored += (ignored.empty() ? "" : ", ") + name;
        }
        ck("(structural) ...and acts on every action it returns", ignored.empty(),
           "main.cpp never reads act." + ignored + " -- the decision says to do it and "
           "the host does not");
      }
      // AND THE HOST TOUCHES THE CAMERA ONCE, TO HAND IT TO THE RENDERER.
      //
      // Two evasions, both MEASURED against the check that stood here before.
      // The first version searched for `camera().frame(` and was defeated by
      // `Camera& cam = frame.camera(); cam.frame(...)`. Counting the ACCESSOR
      // instead closed that -- and was defeated in turn by putting the binding
      // and the words this check looks for on ONE line:
      //
      //     Camera& cam = frame.camera();  // handed to viewport.record( below
      //     ...
      //     cam.frame(c, scene.bounds().radius());     // the defect, restored
      //
      // lineWith() takes the FIRST line the accessor appears on, that line
      // mentions viewport.record(, the count is still one, and the gate stayed at
      // 58 checks / 0 failures while forge_desktop compiled, linked and re-framed
      // the camera on every rebuild.
      //
      // Both are closed here: the accessor's one use must be an ARGUMENT to the
      // record call (the record text comes FIRST on that line, not in a trailing
      // comment), and the host must call NO camera method under any name it gives
      // the reference.
      const std::size_t reaches = countOf(src, "frame.camera()");
      ck("(structural) the host reaches for the camera exactly ONCE", reaches == 1,
         std::to_string(reaches) + " uses of frame.camera() in main.cpp");
      const std::string use = lineWith(src, "frame.camera()");
      const std::size_t records = use.find("viewport.record(");
      const std::size_t got = use.find("frame.camera()");
      ck("(structural) ...and that once is an ARGUMENT to the renderer's record call",
         records != std::string::npos && got != std::string::npos && records < got,
         "it is used on: " + use);

      const std::string camPath = srcPath("Camera.hpp");
      std::string camSrc;
      const bool camRead = !camPath.empty() && readFile(camPath, camSrc);
      ck("(structural) forge-desktop/src/Camera.hpp is readable", camRead, camPath);
      if (camRead) {
        const std::vector<std::string> methods = cameraMethodNames(camSrc);
        // NON-VACUITY. A parse that found nothing would make the sweep below
        // pass by looking for nothing at all.
        ck("(structural) Camera.hpp yielded the method names to look for",
           methods.size() >= 8,
           std::to_string(methods.size()) + " non-const Camera methods parsed");
        std::string called;
        for (const std::string& m : methods) {
          if (countOf(src, "." + m + "(") > 0 || countOf(src, "->" + m + "(") > 0) {
            called += (called.empty() ? "" : ", ") + m;
          }
        }
        ck("(structural) the host CALLS no camera method, under any name it gives it",
           called.empty(),
           "main.cpp calls " + called + " on something; an alias is still the camera, "
           "and moving it is a DOCUMENT decision that belongs to ForgeFrame");
      }
    }
  }

  // ── 1. THE FIRST BUILD FRAMES, ONCE ──────────────────────────────────────
  std::printf("\n  1. the first build\n");
  {
    const CamState live = snap(frame.camera());
    const CamState ref = framedOn(scene, frame.camera().aspect());
    std::printf("    (camera: %s)\n", live.str().c_str());
    ck("the window opens with the part framed", framesSameSphere(live, ref),
       live.str() + " vs " + ref.str());
    ck("and it framed exactly once", frame.cameraRefits() == 1,
       std::to_string(frame.cameraRefits()) + " refits");
  }

  // ── 2. A SUCCESSFUL REBUILD MUST NOT MOVE IT ─────────────────────────────
  //
  // The plate grows from 80 mm to 120 mm, so the BOUNDS REALLY CHANGE. That is
  // the hard version of this check on purpose: the removed host rule was
  // defended as "a rebuild can move the bounds", and it can -- the answer is
  // that a user who wants to see the new size presses Fit, exactly as they do
  // in every mechanical CAD system, and one who is iterating a dimension keeps
  // the view they set up.
  std::printf("\n  2. a rebuild that CHANGES THE PART\n");
  {
    frame.camera().orbit(0.6f, -0.25f);
    frame.camera().zoom(3.0f);
    frame.camera().pan(40.0f, 25.0f, 1000.0f);
    const CamState userPut = snap(frame.camera());
    const std::size_t refitsBefore = frame.cameraRefits();
    const std::size_t rebuildsBefore = frame.rebuilds();
    const float widthBefore = scene.bounds().max[0] - scene.bounds().min[0];
    std::printf("    (where the user put it: %s)\n", userPut.str().c_str());

    forge::ui::CommandParams p;
    p.setNumber("feature", 1.0);  // %1 RECT(80, 50)
    p.setNumber("index", 0.0);    // its first number: the 80
    p.setNumber("value", 120.0);
    const forge::ui::DispatchResult r = shell.run("part.edit_feature", p);
    ck("the plate's width was edited through the ONE registry", r.ok(),
       forge::ui::machineName(r.status) + std::string(" ") + r.detail);
    step(frame, scene);
    const float widthAfter = scene.bounds().max[0] - scene.bounds().min[0];
    // Refuse to pass vacuously: if the part did not actually change size, an
    // unmoved camera proves nothing at all.
    ck("  ...and the part really did get bigger", widthAfter > widthBefore + 1.0f,
       std::to_string(widthBefore) + " -> " + std::to_string(widthAfter) + " mm in X");
    ck("  ...through a real rebuild", frame.rebuilds() > rebuildsBefore,
       std::to_string(frame.rebuilds()) + " rebuilds");
    // The over-correction guard. Fixing the camera by never telling the host to
    // re-upload would leave the OLD triangles on screen, which is worse. Asked
    // through the SHIPPED DECISION rather than of the raw flag, so it is the
    // host's actual answer for this request and not the gate's reading of it.
    ck("the host is still told to re-upload the vertex buffer",
       forge::desktop::hostViewportActions(frame.viewport()).uploadVertices,
       "the host's decision for this request asks for no upload; the rebuild's "
       "new triangles would never reach the GPU");

    const CamState after = snap(frame.camera());
    ck("THE CAMERA DID NOT MOVE", after == userPut,
       "was " + userPut.str() + ", now " + after.str());
    ck("  ...and nothing re-framed it", frame.cameraRefits() == refitsBefore,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore));
  }

  // ── 3. A FAILED REBUILD MUST NOT MOVE IT EITHER ──────────────────────────
  std::printf("\n  3. a rebuild the KERNEL REFUSES\n");
  {
    frame.camera().orbit(-0.4f, 0.2f);
    frame.camera().zoom(2.0f);
    const CamState userPut = snap(frame.camera());
    const std::size_t refitsBefore = frame.cameraRefits();
    std::printf("    (where the user put it: %s)\n", userPut.str().c_str());

    forge::ui::EntityRef body;
    body.bodyId = frame.activeBodyNode();
    body.kind = forge::ui::EntityKind::Edge;
    body.persistentName = "edge@all";
    body.generation = 1;
    shell.selection().replaceWith({body});
    forge::ui::CommandParams bad;
    bad.setNumber("radius", 100000.0);  // larger than the part: the kernel declines
    shell.run("part.fillet", bad);
    step(frame, scene);

    // Same precondition discipline as transaction_gate: with no failure there is
    // nothing to assert about, and a green would be vacuous.
    ck("the kernel really refused the statement", !frame.rebuildError().empty(),
       "rebuildError is empty -- the kernel BUILT it, so this check has no failure "
       "to observe; pick a statement it really refuses");

    const CamState after = snap(frame.camera());
    ck("THE CAMERA DID NOT MOVE ON A FAILURE", after == userPut,
       "was " + userPut.str() + ", now " + after.str());
    ck("  ...and nothing re-framed it", frame.cameraRefits() == refitsBefore,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore));
  }

  // ── 4. FIT STILL WORKS ───────────────────────────────────────────────────
  //
  // The other half of the fix, and the half a "never move the camera" patch
  // would have broken silently. `view.fit` is the USER asking, so it is not
  // counted as a document re-frame -- it goes through applyPendingFit(), which
  // the frame pulls once per build().
  std::printf("\n  4. the user asks for Fit\n");
  {
    frame.camera().zoom(-8.0f);
    frame.camera().pan(300.0f, -220.0f, 1000.0f);
    const CamState lost = snap(frame.camera());
    const std::size_t fitsBefore = frame.fitsApplied();
    const std::size_t refitsBefore = frame.cameraRefits();
    std::printf("    (camera lost at: %s)\n", lost.str().c_str());

    if (g_mutation != 3) {
      const forge::ui::DispatchResult r = shell.run("view.fit");
      ck("view.fit dispatched through the ONE registry", r.ok(),
         forge::ui::machineName(r.status));
    }
    step(frame, scene);  // the frame PULLS the fit; no invoker pushes at the camera

    const CamState after = snap(frame.camera());
    const CamState ref = framedOn(scene, frame.camera().aspect());
    ck("Fit framed the part", framesSameSphere(after, ref),
       after.str() + " vs " + ref.str());
    ck("  ...and the frame builder recorded it", frame.fitsApplied() > fitsBefore,
       std::to_string(frame.fitsApplied()) + " vs " + std::to_string(fitsBefore));
    ck("  ...without counting as a document re-frame",
       frame.cameraRefits() == refitsBefore,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore));
    // Orbit is the user's and Fit does not take it: Camera::frame() writes the
    // target and the distance only. Asserting this keeps "Fit works" from being
    // satisfied by something that resets the whole camera.
    ck("  ...and Fit left the user's orbit alone",
       after.azimuth == lost.azimuth && after.elevation == lost.elevation,
       "az/el moved: " + lost.str() + " -> " + after.str());
  }

  // ── 5. OPENING A DOCUMENT MUST RE-FRAME ──────────────────────────────────
  //
  // A part four times the size of the open one. If the camera kept the distance
  // that suited the last document, the newly opened part would be off screen --
  // which is the failure the old unconditional re-frame was protecting against,
  // and it has to keep being prevented.
  std::printf("\n  5. a DIFFERENT document is opened\n");
  {
    forge::ui::PartDocument big;
    big.seed(forge::ui::IrValueKind::Solid, "body.big", "BOX",
             {forge::ui::IrArg::num(400.0), forge::ui::IrArg::num(300.0),
              forge::ui::IrArg::num(200.0)});
    const forge::desktop::PartFileDoc file =
        // ── MERGE 2026-09-12: capturePartDocument grew a fourth parameter on the
        //    branch this gate merged with -- the SOURCE FILE a document was built
        //    from, which is what makes an imported STEP survive Save and reopen.
        //    These three documents are BOX programs with no imported source, so
        //    the honest argument is the empty string; passing the fixture's own
        //    path would make them claim a binding they do not have.
        forge::desktop::capturePartDocument(big, "big", forge::ui::DrawingModel{},
                                            /*inputFile=*/std::string());
    const std::string path = tempPath("big.fpart");
    std::string err;
    ck("a much larger part was written to a .fpart",
       forge::desktop::savePartFile(path, file, err), err);

    frame.camera().zoom(6.0f);  // dive into the small part
    const std::size_t refitsBefore = frame.cameraRefits();
    const CamState before = snap(frame.camera());
    std::printf("    (camera before the open: %s)\n", before.str().c_str());

    if (g_mutation == 4) {
      // The defect this check exists for: the document is re-derived, but
      // nothing tells the camera a DIFFERENT PART is now on screen.
      frame.documentChanged();
    } else {
      forge::ui::CommandParams p;
      p.setText("path", path);
      const forge::ui::DispatchResult r = shell.run("file.open", p);
      ck("file.open dispatched through the ONE registry", r.ok(),
         forge::ui::machineName(r.status) + std::string(" ") + r.detail);
    }
    step(frame, scene);

    const CamState after = snap(frame.camera());
    const CamState ref = framedOn(scene, frame.camera().aspect());
    std::printf("    (camera after the open:  %s)\n", after.str().c_str());
    ck("opening a document re-framed the camera exactly once",
       frame.cameraRefits() == refitsBefore + 1,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore + 1));
    ck("  ...onto the NEW part", framesSameSphere(after, ref),
       after.str() + " vs " + ref.str());
    ck("  ...so the view really moved", !(after == before),
       "the camera is exactly where it was before a different part was opened");
    std::remove(path.c_str());
  }

  // ── 6. THE DOCUMENT IS EMPTIED AND REFILLED ──────────────────────────────
  //
  // File > Import STEP and Load Sample take this route and not file.open:
  // ForgeShell::runImport calls documentHost_->documentReset() and THEN writes
  // the statements that build the body. So the framing request is raised on a
  // document that has nothing in it, and the build it triggers has no bounds to
  // frame -- which is exactly why syncSceneToDocument KEEPS the request instead
  // of consuming it. A request consumed by the empty build would leave an
  // imported part framed for the document it replaced.
  //
  // Driven with two ordinary Part commands rather than app.load_sample, so the
  // check stands on the reset contract alone and not on whether a particular
  // shipped sample happens to build on this kernel -- one of them, "bracket",
  // does not: its SHELL step is declined by OCCT here.
  std::printf("\n  6. the document is EMPTIED, then refilled (Import / Load Sample)\n");
  {
    const std::size_t refitsAtStart = frame.cameraRefits();
    const CamState before = snap(frame.camera());

    if (g_mutation == 4) {
      // Mutation 4 left the document unopened, so there is nothing coherent to
      // empty and refill; the checks above have already gone red.
      std::printf("    (skipped under mutation 4)\n");
    } else {
      if (g_mutation != 5) {
        std::string err;
        // What the scene is showing BEFORE the reset. Emptying the document does
        // not change it: the empty program does not build, so the previous body
        // stays on screen -- which is the whole reason the two checks below can
        // be made at all.
        const std::string showing = frame.documentProgram();
        ck("  (the scene is showing a named body to begin with)", !showing.empty(),
           "builtProgram_ is already empty, so the check below cannot fail");
        ck("the document was emptied", frame.documentReset(err), err);
        step(frame, scene);
        // THE SUBTLE HALF. An empty document has no sphere, so nothing may have
        // been framed yet -- and the request must still be outstanding.
        ck("  ...and emptying it framed nothing", frame.cameraRefits() == refitsAtStart,
           std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsAtStart));
        // AND THE NAME OF WHAT IS ON SCREEN MUST NOT HAVE BEEN EMPTIED WITH IT.
        // documentReset() cleared builtProgram_ under the claim that the viewport
        // then shows an empty document. It measurably does not -- the empty
        // program does not build and the previous body is still there -- so
        // clearing the one field that answers "what is the scene showing" made it
        // name nothing while the scene named something.
        ck("  ...and the scene still names the body it is still showing",
           frame.documentProgram() == showing,
           "builtProgram_ went from [" + showing.substr(0, 40) + "] to [" +
               frame.documentProgram().substr(0, 40) + "] while the viewport kept the "
               "body it was already drawing");
      }

      forge::ui::CommandParams rect;
      rect.setNumber("width", 300.0);
      rect.setNumber("height", 200.0);
      const forge::ui::DispatchResult r1 = shell.run("part.sketch_rect", rect);
      ck("a profile was authored into the emptied document", r1.ok(),
         forge::ui::machineName(r1.status) + std::string(" ") + r1.detail);

      // Asked of the document rather than written down as "sketch_1": under
      // mutation 5 the profile lands at a different statement id, and a literal
      // would make that mutation fail on a stale node name instead of on the
      // framing this check is about.
      const std::vector<forge::ui::FeatureRecord>& recs = frame.document().records();
      const std::string sketchNode =
          recs.empty() ? std::string() : frame.document().nodeFor(recs.back().irId);
      ck("  ...and the document bound a node to it", !sketchNode.empty(),
         "no node for the profile statement");
      forge::ui::EntityRef sketch;
      sketch.bodyId = sketchNode;
      sketch.kind = forge::ui::EntityKind::Sketch;
      sketch.persistentName = sketchNode;
      sketch.generation = 1;
      shell.selection().replaceWith({sketch});
      forge::ui::CommandParams ext;
      ext.setNumber("distance", 150.0);
      const forge::ui::DispatchResult r2 = shell.run("part.extrude", ext);
      ck("  ...and extruded into a body", r2.ok(),
         forge::ui::machineName(r2.status) + std::string(" ") + r2.detail);
      step(frame, scene);

      ck("  ...which really built", frame.rebuildError().empty(), frame.rebuildError());
      const CamState after = snap(frame.camera());
      const CamState ref = framedOn(scene, frame.camera().aspect());
      std::printf("    (camera after the refill: %s)\n", after.str().c_str());
      ck("the refilled document re-framed the camera exactly once",
         frame.cameraRefits() == refitsAtStart + 1,
         std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsAtStart + 1));
      ck("  ...onto the body that replaced the old one", framesSameSphere(after, ref),
         after.str() + " vs " + ref.str());
      ck("  ...so the view really moved", !(after == before),
         "the camera is exactly where it was before the document was replaced");
    }
  }

  // ── 7. A PLAIN EDIT AFTER AN OPEN ────────────────────────────────────────
  //
  // THE HOLE THIS CLOSES. Checks 2 and 3 assert camera stability in the PRISTINE
  // STARTUP STATE, where refitCameraPending_ is already clear -- so they pass
  // whether the latch is consumed or not. Measured: deleting the single line
  // `refitCameraPending_ = false;` from ForgeFrame.cpp -- arm once, never
  // consume -- left this gate at 33 checks / 0 failures and exit 0 while
  // breaking every rebuild after an open. A gate that stays green when the line
  // it exists to protect is deleted is not a gate.
  //
  // So the stability claim is made again on the far side of a DOCUMENT EVENT,
  // which is the only state in which the latch is ever set.
  std::printf("\n  7. a PLAIN EDIT after a document has been opened\n");
  {
    forge::ui::PartDocument plate;
    plate.seed(forge::ui::IrValueKind::Solid, "body.plate", "BOX",
               {forge::ui::IrArg::num(220.0), forge::ui::IrArg::num(140.0),
                forge::ui::IrArg::num(30.0)});
    const forge::desktop::PartFileDoc file =
        forge::desktop::capturePartDocument(plate, "plate", forge::ui::DrawingModel{},
                                            /*inputFile=*/std::string());
    const std::string path = tempPath("after_open.fpart");
    std::string err;
    ck("a part was written to a .fpart", forge::desktop::savePartFile(path, file, err), err);

    forge::ui::CommandParams op;
    op.setText("path", path);
    const forge::ui::DispatchResult ro = shell.run("file.open", op);
    ck("it was opened through the ONE registry", ro.ok(),
       forge::ui::machineName(ro.status) + std::string(" ") + ro.detail);
    step(frame, scene);

    // THE USER SETS UP THEIR VIEW, on the document they just opened.
    frame.camera().orbit(0.45f, -0.2f);
    frame.camera().zoom(2.5f);
    frame.camera().pan(30.0f, 18.0f, 1000.0f);
    const CamState userPut = snap(frame.camera());
    const std::size_t refitsBefore = frame.cameraRefits();
    const std::size_t rebuildsBefore = frame.rebuilds();
    const float widthBefore = scene.bounds().max[0] - scene.bounds().min[0];
    std::printf("    (where the user put it: %s)\n", userPut.str().c_str());

    forge::ui::CommandParams p;
    p.setNumber("feature", 1.0);
    p.setNumber("index", 0.0);
    p.setNumber("value", 460.0);
    const forge::ui::DispatchResult re = shell.run("part.edit_feature", p);
    ck("a dimension was edited through the ONE registry", re.ok(),
       forge::ui::machineName(re.status) + std::string(" ") + re.detail);
    step(frame, scene);

    ck("  ...through a real rebuild", frame.rebuilds() > rebuildsBefore,
       std::to_string(frame.rebuilds()) + " rebuilds");
    ck("  ...and the part really did change size",
       scene.bounds().max[0] - scene.bounds().min[0] > widthBefore + 1.0f,
       std::to_string(widthBefore) + " -> " +
           std::to_string(scene.bounds().max[0] - scene.bounds().min[0]) + " mm in X");

    const CamState after = snap(frame.camera());
    ck("THE CAMERA DID NOT MOVE ON AN EDIT AFTER AN OPEN", after == userPut,
       "was " + userPut.str() + ", now " + after.str());
    ck("  ...and nothing re-framed it", frame.cameraRefits() == refitsBefore,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore));
    std::remove(path.c_str());
  }

  // ── 8. A DOCUMENT EVENT THAT PRODUCES AN IDENTICAL PROGRAM ───────────────
  //
  // THE INSTANCE OF THE ORIGINAL DEFECT THAT SURVIVED THE FIX.
  //
  // syncSceneToDocument() guards on `program == lastAttemptedProgram_` and
  // returns EARLY -- correctly, because re-running a rebuild that would produce
  // the same body is a spin. But the framing latch is consumed further down, so
  // a document event whose program happens to equal the one already loaded --
  // re-opening the file that is already open, File > New on an untouched
  // starter part, Load Sample of the sample already loaded -- raised the latch
  // and left it armed. The NEXT PLAIN EDIT then collected it and threw the
  // user's pan and zoom away: the original defect, alive on the one path that
  // skips the rule written to prevent it.
  std::printf("\n  8. an open that produces the SAME program as the one loaded\n");
  {
    forge::ui::PartDocument same;
    same.seed(forge::ui::IrValueKind::Solid, "body.same", "BOX",
              {forge::ui::IrArg::num(180.0), forge::ui::IrArg::num(120.0),
               forge::ui::IrArg::num(90.0)});
    const forge::desktop::PartFileDoc file =
        forge::desktop::capturePartDocument(same, "same", forge::ui::DrawingModel{},
                                            /*inputFile=*/std::string());
    const std::string path = tempPath("same.fpart");
    std::string err;
    ck("a part was written to a .fpart", forge::desktop::savePartFile(path, file, err), err);

    forge::ui::CommandParams op;
    op.setText("path", path);
    const forge::ui::DispatchResult r1 = shell.run("file.open", op);
    ck("it was opened once", r1.ok(),
       forge::ui::machineName(r1.status) + std::string(" ") + r1.detail);
    step(frame, scene);

    // The user dives into it, then opens THE SAME FILE AGAIN. The program the
    // document produces is byte-identical to the one already built.
    frame.camera().zoom(5.0f);
    frame.camera().pan(-60.0f, 40.0f, 1000.0f);
    const CamState dived = snap(frame.camera());
    const std::size_t refitsBeforeReopen = frame.cameraRefits();
    const std::size_t rebuildsBeforeReopen = frame.rebuilds();

    if (g_mutation == 6) {
      // The document is re-derived without anybody saying a DOCUMENT EVENT
      // happened, so no framing is ever requested.
      frame.documentChanged();
    } else {
      const forge::ui::DispatchResult r2 = shell.run("file.open", op);
      ck("  ...and opened a SECOND time, same file", r2.ok(),
         forge::ui::machineName(r2.status) + std::string(" ") + r2.detail);
    }
    step(frame, scene);

    // ── MERGE 2026-09-12: THIS CONTROL WAS INVERTED, BY THE OTHER PARENT.
    //
    // It used to read `frame.rebuilds() == rebuildsBeforeReopen` -- "the second
    // open really did SKIP the rebuild (identical program)" -- and it was a
    // correct anti-vacuous control when it was written: documentOpen() cleared
    // builtProgram_ under the comment "force the rebuild below", the rebuild is
    // guarded on lastAttemptedProgram_, so clearing forced nothing and an open
    // whose program text matched the document already open skipped entirely.
    //
    // That skip was a DEFECT, and the branch this gate merged with fixed it:
    // documentOpen() now clears lastAttemptedProgram_ too, which is what forces
    // the rebuild the old comment claimed. It has to, because a different
    // document is a different BUILD even when its text is identical -- the input
    // file, and therefore the solid, is document state beside the program. Open
    // a v4 part built from X.step and then a legacy v3 part naming no source:
    // both programs are `%1 = INPUT()`, and without this the viewport went on
    // showing X's solid inside a document that names no file.
    //
    // So the control is kept and its SENSE is flipped. It is still refusing to
    // pass vacuously -- it is just that the path it guards is now "the second
    // open really did rebuild", and a regression back to skipping turns it red
    // exactly as the original turned red on a rebuild.
    ck("  ...and the second open really did REBUILD (a different document is a "
       "different build, even with identical text)",
       frame.rebuilds() == rebuildsBeforeReopen + 1,
       std::to_string(frame.rebuilds()) + " vs " +
           std::to_string(rebuildsBeforeReopen + 1) +
           " -- the identical-program open skipped, which is the defect "
           "documentOpen's lastAttemptedProgram_.clear() exists to prevent");

    const CamState reopened = snap(frame.camera());
    const CamState ref = framedOn(scene, frame.camera().aspect());
    ck("the second open STILL framed the camera, exactly once",
       frame.cameraRefits() == refitsBeforeReopen + 1,
       std::to_string(frame.cameraRefits()) + " vs " +
           std::to_string(refitsBeforeReopen + 1));
    ck("  ...onto the part", framesSameSphere(reopened, ref),
       reopened.str() + " vs " + ref.str());
    ck("  ...so the view really moved", !(reopened == dived),
       "the camera is exactly where the user left it, so nothing framed");

    // AND THE APPLICATION MUST NOT NOW BELIEVE ITSELF MID-REBUILD.
    //
    // documentOpen() cleared builtProgram_ under the comment "force the rebuild
    // below", and it forced nothing -- the rebuild is guarded on
    // lastAttemptedProgram_ -- so on the path where an open skipped the rebuild
    // it left builtProgram_ naming NOTHING while the scene went on showing a
    // body. THAT PATH IS GONE as of this merge (see the inverted control above):
    // the open really rebuilds, so builtProgram_ is re-established by the build
    // rather than left empty. The check below is therefore no longer about a
    // skip -- it is the invariant itself, that builtProgram_ agrees with the
    // document once the dust settles, and it fails if either the clear or the
    // forced rebuild is removed. builtProgram_ is the staleness witness:
    // the Study panel blocks Run study on `builtProgram_ != irProgram()`, so for
    // as long as this state lasts -- until some later edit happens to rebuild
    // successfully -- a user asking for a study is told "The part is still
    // rebuilding" with nothing rebuilding. That consequence is READ from
    // ForgeFrame.cpp's study panel; what is measured here is the state itself.
    ck("  ...and the app does not now believe the part is mid-rebuild",
       frame.documentProgram() == frame.document().irProgram(),
       "builtProgram_ names [" + frame.documentProgram().substr(0, 48) +
           "] while the document is [" + frame.document().irProgram().substr(0, 48) + "]");

    // AND NOW THE EDIT. If the identical-program open left its request armed,
    // this is where it lands.
    frame.camera().orbit(-0.3f, 0.15f);
    frame.camera().zoom(1.5f);
    const CamState userPut = snap(frame.camera());
    const std::size_t refitsBefore = frame.cameraRefits();
    const std::size_t rebuildsBefore = frame.rebuilds();
    std::printf("    (where the user put it: %s)\n", userPut.str().c_str());

    forge::ui::CommandParams p;
    p.setNumber("feature", 1.0);
    p.setNumber("index", 0.0);
    p.setNumber("value", 520.0);
    const forge::ui::DispatchResult re = shell.run("part.edit_feature", p);
    ck("a dimension was edited through the ONE registry", re.ok(),
       forge::ui::machineName(re.status) + std::string(" ") + re.detail);
    step(frame, scene);
    ck("  ...through a real rebuild", frame.rebuilds() > rebuildsBefore,
       std::to_string(frame.rebuilds()) + " rebuilds");

    const CamState after = snap(frame.camera());
    ck("THE CAMERA DID NOT MOVE ON THE EDIT THAT FOLLOWED", after == userPut,
       "was " + userPut.str() + ", now " + after.str());
    ck("  ...and nothing re-framed it", frame.cameraRefits() == refitsBefore,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore));
    std::remove(path.c_str());
  }

  // ── 9. FILE > NEW ────────────────────────────────────────────────────────
  //
  // THE ARM SIDE OF THE HOLE CHECK 8 CLOSED ON THE CONSUME SIDE. Every check
  // above reaches the camera through documentOpen() or documentReset(); NOTHING
  // drove documentNew(). MEASURED, against the code as it stood: deleting
  // `refitCameraPending_ = true;` from ForgeFrame::documentNew() -- File > New
  // never asks to be framed -- left this gate at 58 checks / 0 failures and
  // exit 0, with every new part opening under whatever camera the document it
  // replaced was left at.
  //
  // New is run TWICE, deliberately. The second one seeds the same starter part
  // the first one did, so its program is IDENTICAL and it takes the early-return
  // path -- the exact shape that kept the original defect alive on open.
  std::printf("\n  9. File > New, twice\n");
  {
    frame.camera().zoom(7.0f);
    frame.camera().pan(-80.0f, 55.0f, 1000.0f);
    const CamState dived = snap(frame.camera());
    const std::size_t refitsBefore = frame.cameraRefits();
    const std::size_t rebuildsBefore = frame.rebuilds();

    const forge::ui::DispatchResult r1 = shell.run("file.new");
    ck("file.new dispatched through the ONE registry", r1.ok(),
       forge::ui::machineName(r1.status) + std::string(" ") + r1.detail);
    step(frame, scene);

    ck("  ...and it really replaced the document", frame.rebuilds() > rebuildsBefore,
       std::to_string(frame.rebuilds()) + " vs " + std::to_string(rebuildsBefore) +
           " rebuilds -- New produced the program already loaded, so this check is "
           "not on the path it names");
    const CamState afterNew = snap(frame.camera());
    ck("New framed the camera exactly once", frame.cameraRefits() == refitsBefore + 1,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refitsBefore + 1));
    ck("  ...onto the starter part",
       framesSameSphere(afterNew, framedOn(scene, frame.camera().aspect())),
       afterNew.str() + " vs " + framedOn(scene, frame.camera().aspect()).str());
    ck("  ...so the view really moved", !(afterNew == dived),
       "the camera is exactly where the user left it in the document New threw away");

    // AGAIN, on the untouched starter part New just seeded: identical program.
    frame.camera().zoom(4.0f);
    frame.camera().orbit(0.5f, -0.3f);
    const CamState dived2 = snap(frame.camera());
    const std::size_t refits2 = frame.cameraRefits();
    const std::size_t rebuilds2 = frame.rebuilds();
    const forge::ui::DispatchResult r2 = shell.run("file.new");
    ck("  ...New again, on the untouched starter part", r2.ok(),
       forge::ui::machineName(r2.status) + std::string(" ") + r2.detail);
    step(frame, scene);
    ck("  ...and the second New really did SKIP the rebuild (identical program)",
       frame.rebuilds() == rebuilds2,
       std::to_string(frame.rebuilds()) + " vs " + std::to_string(rebuilds2) +
           " -- the programs differed, so this check is not on the path it names");
    const CamState afterNew2 = snap(frame.camera());
    ck("the second New STILL framed the camera, exactly once",
       frame.cameraRefits() == refits2 + 1,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refits2 + 1));
    ck("  ...so the view really moved", !(afterNew2 == dived2),
       "the camera is exactly where the user left it, so nothing framed");

    // AND THE EDIT AFTER IT MUST NOT.
    frame.camera().orbit(-0.2f, 0.1f);
    const CamState userPut = snap(frame.camera());
    const std::size_t refits3 = frame.cameraRefits();
    const std::size_t rebuilds3 = frame.rebuilds();
    forge::ui::CommandParams p;
    p.setNumber("feature", 1.0);
    p.setNumber("index", 0.0);
    p.setNumber("value", 140.0);
    const forge::ui::DispatchResult re = shell.run("part.edit_feature", p);
    ck("a dimension was edited through the ONE registry", re.ok(),
       forge::ui::machineName(re.status) + std::string(" ") + re.detail);
    step(frame, scene);
    ck("  ...through a real rebuild", frame.rebuilds() > rebuilds3,
       std::to_string(frame.rebuilds()) + " rebuilds");
    const CamState afterEdit = snap(frame.camera());
    ck("THE CAMERA DID NOT MOVE ON THE EDIT AFTER A NEW", afterEdit == userPut,
       "was " + userPut.str() + ", now " + afterEdit.str());
    ck("  ...and nothing re-framed it", frame.cameraRefits() == refits3,
       std::to_string(frame.cameraRefits()) + " vs " + std::to_string(refits3));
  }

  // ── 10. A WINDOW THAT OPENS ON A KERNEL FAILURE ──────────────────────────
  //
  // The constructor frames unconditionally -- and an invalid bounding box has no
  // sphere in it, so Camera::frame() there parks the camera at the origin at a
  // default distance and frames NOTHING. That was counted as a framing:
  // cameraRefits_ read 1 for a window that had framed nothing, and 2 once the
  // first real body arrived and was framed for the first time. cameraRefits_ is
  // the instrument every check above reads.
  //
  // A SECOND, SEPARATE APPLICATION, because the state under test is the one the
  // first line of the constructor produces and no later call can restore it.
  std::printf("\n  10. a window that opens with NO BODY\n");
  {
    forge::desktop::KernelScene empty;  // deliberately never built
    ck("the scene really has no body to frame", !empty.bounds().valid,
       "bounds are valid -- this check is not in the state it names");
    forge::ui::ForgeShell shell2;
    g_shell = &shell2;
    forge::desktop::ForgeFrame frame2(shell2, empty);
    ck("the window framed NOTHING, and counted nothing", frame2.cameraRefits() == 0,
       std::to_string(frame2.cameraRefits()) + " refits recorded by a window that had "
       "no body to frame");
    // AND IT KEEPS DRAWING. The frame loop runs whether or not the kernel
    // produced anything, and each of those frames calls syncSceneToDocument()
    // with a document whose program has not changed -- the early-return path,
    // with the framing request still outstanding and NO SPHERE TO FRAME. This is
    // the state the `scene_.bounds().valid` clause of applyDocumentRefit()'s
    // guard exists for: without it these frames consume the request, count a
    // refit for a framing of nothing, and the first real body is then never
    // framed at all. MEASURED: deleting that clause left this gate green until
    // these two lines existed.
    step(frame2, empty);
    step(frame2, empty);
    ck("  ...and drawing frames with no body still framed nothing",
       frame2.cameraRefits() == 0,
       std::to_string(frame2.cameraRefits()) + " refits after two frames with no body");
    frame2.wirePartCommands();
    step(frame2, empty);
    ck("  ...and the first body it does get is framed, exactly once",
       frame2.cameraRefits() == 1,
       std::to_string(frame2.cameraRefits()) + " refits after the first real build");
    const CamState after2 = snap(frame2.camera());
    const CamState ref2 = framedOn(empty, frame2.camera().aspect());
    ck("  ...onto that body", framesSameSphere(after2, ref2), after2.str() + " vs " + ref2.str());
  }

  // ── THE HOST RUNNER ITSELF WAS NOT A NO-OP ───────────────────────────────
  // g_host is written on every step(). If nothing ever read it, "the camera did
  // not move while the host reacted" could be satisfied by a host that never
  // reacted -- the counter-nobody-reads defect this repository has already paid
  // for once. So it is read here, and the run is REQUIRED to have driven the
  // host's two expensive actions for real.
  std::printf("\n  the host's reaction over the whole run\n");
  ck("the host really reacted: it was told to re-upload vertices", g_host.uploads > 0,
     std::to_string(g_host.uploads) + " uploads");
  ck("  ...and to drain the device before a resized buffer", g_host.waits > 0,
     std::to_string(g_host.waits) + " device drains");

  std::printf("\n[camera] %d checks, %d failures\n", g_checks, g_failures);
  if (g_mutation != 0 && g_failures == 0) {
    std::printf("[camera] mutation %d was NOT caught\n", g_mutation);
    return 1;
  }
  return g_failures == 0 ? 0 : 1;
}
