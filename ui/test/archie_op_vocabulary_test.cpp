// ui/test/archie_op_vocabulary_test.cpp
//
// CONTRACT -- the committed op vocabulary is what the LIVE registry does.
//
// implementation/sacrosanct/archie_op_vocabulary.json is the list of feature-IR
// ops Archie is allowed to emit: the ops a USER can reach through the forge::ui
// command registry, and nothing else. It is generated from the sources by
// implementation/sacrosanct/tools/gen_archie_op_vocabulary.py, whose --check
// mode proves the file still matches the TEXT of those sources.
//
// This gate proves the other half, which a text diff cannot: that the file
// matches the RUNNING code. It builds the same registry the app builds
// (ForgeShell + registerPartCommands), then
//   (a) diffs every command's contract -- id, label, category, feature-IR op,
//       selection signature and parameter schema -- against the JSON,
//   (b) checks every allowed op against forge::ui::irOpTable(), which
//       feature_ir_test.cpp separately proves is the kernel's own table,
//   (c) DISPATCHES every example in the file and compares the statement the
//       document actually recorded, token by token, with the one the file says
//       that command emits, and
//   (d) drives the "declares an op it never emits" defects the file records, so
//       a defect that gets fixed cannot sit in the vocabulary unnoticed.
//
// A wrong signature here would teach the model an API the product does not have,
// so the file is asserted against behaviour, never against itself. The JSON is
// read as DATA with a minimal reader below -- no third-party dependency, no
// network, headless like every other gate in this directory.
#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstdio>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "forge/ui/CommandRegistry.hpp"
#include "forge/ui/FeatureIr.hpp"
#include "forge/ui/ForgeShell.hpp"
#include "forge/ui/PartCommands.hpp"
#include "forge/ui/SelectionService.hpp"
#include "forge/ui/Types.hpp"
#include "ui_test_util.hpp"

using namespace forge::ui;
using forge::uitest::Harness;

namespace {

// ── a minimal JSON reader ───────────────────────────────────────────────────
// Enough of RFC 8259 to read the file this repo generates, and no more. The
// generator refuses to emit a \u escape or any non-ASCII byte (see to_ascii in
// gen_archie_op_vocabulary.py), so this reader does not have to decode one --
// and it REFUSES rather than guesses if it ever meets one.
struct JsonValue {
  enum class Kind { Null, Bool, Number, String, Array, Object };
  Kind kind = Kind::Null;
  bool boolean = false;
  double number = 0.0;
  std::string str;
  std::vector<std::size_t> items;                            // Array
  std::vector<std::pair<std::string, std::size_t>> fields;   // Object
};

class Json {
 public:
  bool parse(const std::string& text) {
    nodes_.clear();
    src_ = &text;
    pos_ = 0;
    error_.clear();
    const std::size_t root = value();
    if (!error_.empty()) return false;
    skip();
    if (pos_ != text.size()) {
      error_ = "trailing text at offset " + std::to_string(pos_);
      return false;
    }
    root_ = root;
    return true;
  }

  const std::string& error() const noexcept { return error_; }
  const JsonValue& root() const { return node(root_); }
  const JsonValue& node(std::size_t i) const {
    static const JsonValue kNull{};
    return i < nodes_.size() ? nodes_[i] : kNull;
  }

  bool has(const JsonValue& v, const std::string& key) const {
    for (const auto& f : v.fields) {
      if (f.first == key) return true;
    }
    return false;
  }
  const JsonValue& at(const JsonValue& v, const std::string& key) const {
    for (const auto& f : v.fields) {
      if (f.first == key) return node(f.second);
    }
    static const JsonValue kNull{};
    return kNull;
  }
  const JsonValue& at(const JsonValue& v, std::size_t i) const {
    return i < v.items.size() ? node(v.items[i]) : node(nodes_.size() + 1);
  }
  std::string text(const JsonValue& v, const std::string& key) const {
    return at(v, key).str;
  }
  double num(const JsonValue& v, const std::string& key) const {
    return at(v, key).number;
  }

 private:
  void skip() {
    while (pos_ < src_->size() &&
           std::isspace(static_cast<unsigned char>((*src_)[pos_])) != 0) {
      ++pos_;
    }
  }
  std::size_t push(JsonValue v) {
    nodes_.push_back(std::move(v));
    return nodes_.size() - 1;
  }
  void fail(const std::string& why) {
    if (error_.empty()) error_ = why + " at offset " + std::to_string(pos_);
  }

  std::size_t value() {
    if (!error_.empty()) return 0;
    skip();
    if (pos_ >= src_->size()) {
      fail("unexpected end of input");
      return 0;
    }
    const char c = (*src_)[pos_];
    if (c == '{') return object();
    if (c == '[') return array();
    if (c == '"') {
      JsonValue v;
      v.kind = JsonValue::Kind::String;
      v.str = string();
      return push(std::move(v));
    }
    if (src_->compare(pos_, 4, "true") == 0) {
      pos_ += 4;
      JsonValue v;
      v.kind = JsonValue::Kind::Bool;
      v.boolean = true;
      return push(std::move(v));
    }
    if (src_->compare(pos_, 5, "false") == 0) {
      pos_ += 5;
      JsonValue v;
      v.kind = JsonValue::Kind::Bool;
      v.boolean = false;
      return push(std::move(v));
    }
    if (src_->compare(pos_, 4, "null") == 0) {
      pos_ += 4;
      return push(JsonValue{});
    }
    return number();
  }

  std::size_t object() {
    JsonValue v;
    v.kind = JsonValue::Kind::Object;
    ++pos_;  // '{'
    skip();
    if (pos_ < src_->size() && (*src_)[pos_] == '}') {
      ++pos_;
      return push(std::move(v));
    }
    while (error_.empty()) {
      skip();
      if (pos_ >= src_->size() || (*src_)[pos_] != '"') {
        fail("expected a key");
        break;
      }
      const std::string key = string();
      skip();
      if (pos_ >= src_->size() || (*src_)[pos_] != ':') {
        fail("expected ':'");
        break;
      }
      ++pos_;
      v.fields.emplace_back(key, value());
      skip();
      if (pos_ < src_->size() && (*src_)[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (pos_ < src_->size() && (*src_)[pos_] == '}') {
        ++pos_;
        break;
      }
      fail("expected ',' or '}'");
      break;
    }
    return push(std::move(v));
  }

  std::size_t array() {
    JsonValue v;
    v.kind = JsonValue::Kind::Array;
    ++pos_;  // '['
    skip();
    if (pos_ < src_->size() && (*src_)[pos_] == ']') {
      ++pos_;
      return push(std::move(v));
    }
    while (error_.empty()) {
      v.items.push_back(value());
      skip();
      if (pos_ < src_->size() && (*src_)[pos_] == ',') {
        ++pos_;
        continue;
      }
      if (pos_ < src_->size() && (*src_)[pos_] == ']') {
        ++pos_;
        break;
      }
      fail("expected ',' or ']'");
      break;
    }
    return push(std::move(v));
  }

  std::string string() {
    std::string out;
    ++pos_;  // opening quote
    while (pos_ < src_->size()) {
      const char c = (*src_)[pos_++];
      if (c == '"') return out;
      if (c != '\\') {
        out += c;
        continue;
      }
      if (pos_ >= src_->size()) break;
      const char e = (*src_)[pos_++];
      switch (e) {
        case '"':  out += '"';  break;
        case '\\': out += '\\'; break;
        case '/':  out += '/';  break;
        case 'b':  out += '\b'; break;
        case 'f':  out += '\f'; break;
        case 'n':  out += '\n'; break;
        case 'r':  out += '\r'; break;
        case 't':  out += '\t'; break;
        default:
          // Including \u: the generator guarantees pure ASCII, so meeting one
          // means the file was not produced by the generator. Refuse it.
          fail(std::string("unsupported escape \\") + e);
          return out;
      }
    }
    fail("unterminated string");
    return out;
  }

  std::size_t number() {
    const std::size_t start = pos_;
    if (pos_ < src_->size() && ((*src_)[pos_] == '-' || (*src_)[pos_] == '+')) ++pos_;
    while (pos_ < src_->size()) {
      const char c = (*src_)[pos_];
      if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+') {
        ++pos_;
        continue;
      }
      break;
    }
    if (pos_ == start) {
      fail("expected a value");
      return 0;
    }
    JsonValue v;
    v.kind = JsonValue::Kind::Number;
    std::istringstream in(src_->substr(start, pos_ - start));
    in >> v.number;
    if (in.fail()) {
      fail("malformed number");
      return 0;
    }
    return push(std::move(v));
  }

  std::vector<JsonValue> nodes_;
  const std::string* src_ = nullptr;
  std::size_t pos_ = 0;
  std::size_t root_ = 0;
  std::string error_;
};

std::string locateVocabulary() {
  const char* candidates[] = {
#ifdef FORGE_UI_REPO_ROOT
      FORGE_UI_REPO_ROOT "/implementation/sacrosanct/archie_op_vocabulary.json",
#endif
      "implementation/sacrosanct/archie_op_vocabulary.json",
      "../implementation/sacrosanct/archie_op_vocabulary.json",
      "../../implementation/sacrosanct/archie_op_vocabulary.json",
  };
  for (const char* p : candidates) {
    std::ifstream in(p);
    if (in.good()) return p;
  }
  return {};
}

// ── the fixture every example is dispatched against ─────────────────────────
// THIRTEEN seeded values with KNOWN ids, so the %role placeholders in the file
// resolve to exact tokens: %profile1..3 = %1..%3, %body = %4, %tool = %5,
// %wire1..2 = %6..%7, %surface / %sheet1..2 = %8..%9, %sketch = %10 and the
// three sketch entities = %11..%13. The two WIRE sections are
// here because LOFT consumes WIRE and not PROFILE -- the kernel's opLoft() reads
// every %ref through refWire() -- so a fixture of profiles alone could not
// dispatch a single LOFT example. The two SHEETS are here for the same reason
// squared: THICKEN / CAP / SURFCHECK each consume one SURFACE and SEW consumes a
// variadic list of them, and neither a profile nor a solid can stand in, because
// the value kind is exactly what the bridge checks.
struct Fixture {
  PartDocument doc;
  UndoStack undo;
  CommandRegistry registry;
  SelectionService selection;

  Fixture() {
    registerPartCommands(registry, doc, undo);
    doc.seed(IrValueKind::Profile, "sketch_1", "RECT", {IrArg::num(80), IrArg::num(60)});
    doc.seed(IrValueKind::Profile, "sketch_2", "CIRCLE", {IrArg::num(12)});
    doc.seed(IrValueKind::Profile, "sketch_3", "RECT", {IrArg::num(40), IrArg::num(40)});
    doc.seed(IrValueKind::Solid, "body_x", "BOX",
             {IrArg::num(50), IrArg::num(40), IrArg::num(20)});
    doc.seed(IrValueKind::Solid, "body_y", "BOX",
             {IrArg::num(10), IrArg::num(10), IrArg::num(10)});
    doc.seed(IrValueKind::Wire, "wire_1", "RING",
             {IrArg::num(20), IrArg::num(20), IrArg::num(0)});
    doc.seed(IrValueKind::Wire, "wire_2", "RING",
             {IrArg::num(12), IrArg::num(12), IrArg::num(30)});
    // Two SHEETS, for the same reason two wires are seeded: SEW's signature is
    // atLeast(Surface, 1) but its whole point is >1, and a fixture that can only
    // ever build the minimum leaves the variadic form undispatched.
    doc.seed(IrValueKind::Surface, "surface_1", "FACES",
             {IrArg::valueRef(4), IrArg::text("all")});
    doc.seed(IrValueKind::Surface, "surface_2", "SKIN",
             {IrArg::valueRef(6), IrArg::valueRef(7)});
    // ── the sketch family's fixture ──────────────────────────────────────────
    // ONE open sketch and THREE entities inside it, and both numbers are forced
    // rather than chosen: SPT and SOLVE consume the SKETCH itself, so a fixture
    // of entities alone could dispatch neither, and SARC names THREE distinct
    // entities, so a fixture with two would render `SARC(%11, %12, %12)` and the
    // token comparison would pass on an arc through one point twice. The three
    // are SPT statements because a point is the only entity that names the
    // sketch directly -- every other entity is built out of points.
    doc.seed(IrValueKind::Sketch, "opensketch_1", "SKETCH", {IrArg::keyword("XY")});
    doc.seed(IrValueKind::SketchRef, "sketchref_1", "SPT",
             {IrArg::valueRef(10), IrArg::num(0), IrArg::num(0)});
    doc.seed(IrValueKind::SketchRef, "sketchref_2", "SPT",
             {IrArg::valueRef(10), IrArg::num(40), IrArg::num(0)});
    doc.seed(IrValueKind::SketchRef, "sketchref_3", "SPT",
             {IrArg::valueRef(10), IrArg::num(40), IrArg::num(30)});
  }

  bool seeded() const {
    return doc.valueFor("sketch_1") == 1 && doc.valueFor("sketch_2") == 2 &&
           doc.valueFor("sketch_3") == 3 && doc.valueFor("body_x") == 4 &&
           doc.valueFor("body_y") == 5 && doc.valueFor("wire_1") == 6 &&
           doc.valueFor("wire_2") == 7 && doc.valueFor("surface_1") == 8 &&
           doc.valueFor("surface_2") == 9 && doc.valueFor("opensketch_1") == 10 &&
           doc.valueFor("sketchref_1") == 11 && doc.valueFor("sketchref_2") == 12 &&
           doc.valueFor("sketchref_3") == 13;
  }
};

EntityRef ref(const std::string& node, EntityKind kind, const std::string& name) {
  return EntityRef{node, kind, name, 1};
}

// The selection a command's own signature demands, built from that signature.
std::vector<EntityRef> selectionFor(const CommandDescriptor& c) {
  const std::size_t want = c.signature.minCount == 0 ? 1 : c.signature.minCount;
  std::vector<EntityRef> refs;
  switch (c.signature.kind) {
    case EntityKind::Sketch:
      for (std::size_t i = 0; i < want && i < 3; ++i) {
        refs.push_back(ref("sketch_" + std::to_string(i + 1), EntityKind::Sketch,
                           "s" + std::to_string(i + 1)));
      }
      break;
    case EntityKind::Face:
      refs.push_back(ref("body_x", EntityKind::Face, "top"));
      break;
    case EntityKind::Edge:
      refs.push_back(ref("body_x", EntityKind::Edge, "e1"));
      break;
    case EntityKind::Body:
      refs.push_back(ref("body_x", EntityKind::Body, "b1"));
      if (want >= 2) refs.push_back(ref("body_y", EntityKind::Body, "b2"));
      break;
    case EntityKind::Wire:
      for (std::size_t i = 0; i < want && i < 2; ++i) {
        refs.push_back(ref("wire_" + std::to_string(i + 1), EntityKind::Wire,
                           "w" + std::to_string(i + 1)));
      }
      break;
    case EntityKind::Surface:
      for (std::size_t i = 0; i < want && i < 2; ++i) {
        refs.push_back(ref("surface_" + std::to_string(i + 1), EntityKind::Surface,
                           "sf" + std::to_string(i + 1)));
      }
      break;
    case EntityKind::OpenSketch:
      refs.push_back(ref("opensketch_1", EntityKind::OpenSketch, "sk1"));
      break;
    case EntityKind::SketchRef:
      // Up to THREE, because SARC takes three. `want` is the signature's own
      // minCount, so each command gets exactly the entities it asks for and no
      // extras -- resolveValues() would refuse a fourth as a size mismatch.
      for (std::size_t i = 0; i < want && i < 3; ++i) {
        refs.push_back(ref("sketchref_" + std::to_string(i + 1), EntityKind::SketchRef,
                           "e" + std::to_string(i + 1)));
      }
      break;
    case EntityKind::Any:
      // edit.delete takes a mixed bag; one ref of any kind satisfies it.
      refs.push_back(ref("body_x", EntityKind::Body, "b1"));
      break;
    default:
      break;
  }
  return refs;
}

// "%body" -> "%4"; anything else is a literal token compared verbatim.
std::string resolvePlaceholder(const std::string& token) {
  if (token == "%body") return "%4";
  if (token == "%tool") return "%5";
  // SECTION's two operands. The generator deliberately does NOT call them
  // target/tool: a section consumes neither body and the operation is symmetric,
  // so borrowing the booleans' names would teach Archie that one of them gets
  // eaten. They still resolve to the SAME two seeded bodies as %body / %tool,
  // because the fixture has exactly two solids and the placeholders name roles,
  // not extra geometry.
  if (token == "%bodyA") return "%4";
  if (token == "%bodyB") return "%5";
  if (token == "%profile") return "%1";
  if (token == "%profile1") return "%1";
  if (token == "%profile2") return "%2";
  if (token == "%profile3") return "%3";
  if (token == "%wire") return "%6";
  if (token == "%wire1") return "%6";
  if (token == "%wire2") return "%7";
  // The two SURFACE roles the generator emits. They are DIFFERENT placeholders on
  // purpose -- "%surface" is the single sheet THICKEN / CAP / SURFCHECK take, and
  // "%sheet1..2" is SEW's variadic list -- and both resolve into the same seeded
  // sheets. Collapsing them to one name here would hide a generator that had lost
  // the repeat on SEW, which is the defect REF_ROLES records for LOFT.
  if (token == "%surface") return "%8";
  if (token == "%sheet1") return "%8";
  if (token == "%sheet2") return "%9";
  // The sketch family. `%sketch` is the SKETCH value; the rest are entities
  // INSIDE it. SCIRC's centre and SARC's centre share the `%centre` spelling
  // because they are the same role in the same position; SARC's three stay
  // DISTINCT, or the comparison would pass on an arc drawn through one point.
  if (token == "%sketch") return "%10";
  if (token == "%p0") return "%11";
  if (token == "%p1") return "%12";
  if (token == "%centre") return "%11";
  if (token == "%arcStart") return "%12";
  if (token == "%arcEnd") return "%13";
  if (token == "%entity") return "%11";
  if (token == "%entityA") return "%11";
  if (token == "%entityB") return "%12";
  return token;
}

std::string joinTokens(const std::vector<IrArg>& args) {
  std::string out;
  for (std::size_t i = 0; i < args.size(); ++i) {
    if (i != 0) out += ", ";
    out += args[i].token();
  }
  return out;
}

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

const char* paramTypeName(ParamType t) {
  switch (t) {
    case ParamType::Number: return "Number";
    case ParamType::Text:   return "Text";
    case ParamType::Flag:   return "Flag";
  }
  return "?";
}

}  // namespace

int main() {
  Harness H("archie_op_vocabulary");

  // ── 0. the reader is asserted before anything is read with it ─────────────
  {
    Json j;
    const std::string sample =
        R"({"a": 1, "b": [1, 2.5, -3e2], "c": {"d": "x\"y"}, "e": true, "f": null})";
    CHECK(j.parse(sample));
    CHECK_EQ_STR(j.error(), "");
    CHECK_NEAR(j.num(j.root(), "a"), 1.0, 1e-12);
    CHECK_EQ_INT(j.at(j.root(), "b").items.size(), 3);
    CHECK_NEAR(j.at(j.at(j.root(), "b"), 2).number, -300.0, 1e-9);
    CHECK_EQ_STR(j.text(j.at(j.root(), "c"), "d"), "x\"y");
    CHECK(j.at(j.root(), "e").boolean);
    CHECK_EQ_INT(static_cast<int>(j.at(j.root(), "f").kind),
                 static_cast<int>(JsonValue::Kind::Null));
    Json bad;
    CHECK(!bad.parse("{\"a\": }"));
    CHECK(!bad.parse("{\"a\": \"\\u00e9\"}"));  // a \u escape is REFUSED, not guessed
  }

  // ── 1. load the committed vocabulary ─────────────────────────────────────
  const std::string path = locateVocabulary();
  CHECK(!path.empty());
  if (path.empty()) {
    std::printf("  FAIL cannot locate implementation/sacrosanct/archie_op_vocabulary.json\n");
    return H.finish();
  }
  std::ifstream in(path);
  std::ostringstream buf;
  buf << in.rdbuf();
  const std::string text = buf.str();
  CHECK(text.size() > 1000);
  Json j;
  CHECK(j.parse(text));
  if (!j.error().empty()) {
    std::printf("  FAIL vocabulary does not parse: %s\n", j.error().c_str());
    return H.finish();
  }
  const JsonValue& doc = j.root();
  CHECK_EQ_STR(j.text(doc, "schema"), "forge.archie.op_vocabulary/1");

  // ── 2. the live registry the app builds ──────────────────────────────────
  ForgeShell shell;
  PartDocument partDoc;
  UndoStack partUndo;
  const std::size_t partAdded = registerPartCommands(shell.registry(), partDoc, partUndo);
  // 58 -- RE-MEASURED on the merged tree at every merge that touches it, never
  // carried over from either side. It has now been contested twice. At the #177
  // merge the base pinned 50 and the incoming branch 58; at the
  // app/differential-gate-v2 merge the base pins 58 and the incoming branch 43.
  //
  // The method is the same both times: count `part.*` rows in the regenerated
  // APP_SURFACE_MANIFEST.tsv, CALIBRATED FIRST against BOTH parents' committed
  // manifests. At this merge it reproduced their own 58 and 43 exactly, and only
  // then was it run on the regenerated merged manifest, which gives 58.
  //
  // It lands on 58 rather than a third number because the command sets are
  // NESTED, and that is checked as a SET DIFFERENCE rather than assumed:
  // app/differential-gate-v2 adds ZERO `part.*` commands the base lacks -- its
  // whole contribution is the differential gate, the CoPilot binder and the
  // forge_verify transcript reader, none of which registers a command -- while
  // the base adds fifteen it lacks (the 2D sketch + constraint family and the
  // SURFACE ops). So 58 is |ours union theirs|, and the 43 are a strict subset.
  CHECK_EQ_INT(partAdded, 58);
  const std::vector<std::string> liveIds = shell.registry().ids();
  const JsonValue& counts = j.at(doc, "counts");
  CHECK_EQ_INT(liveIds.size(), static_cast<long long>(j.num(counts, "registry_commands")));

  const JsonValue& commands = j.at(doc, "commands");
  CHECK_EQ_INT(commands.items.size(), liveIds.size());
  for (std::size_t i = 0; i < commands.items.size(); ++i) {
    const JsonValue& c = j.at(commands, i);
    const std::string id = j.text(c, "id");
    const CommandDescriptor* live = shell.registry().find(id);
    CHECK(live != nullptr);
    if (live == nullptr) {
      std::printf("  FAIL vocabulary lists command %s, the registry has no such id\n", id.c_str());
      continue;
    }
    CHECK_EQ_STR(live->label, j.text(c, "label"));
    CHECK_EQ_STR(live->category, j.text(c, "category"));
    CHECK_EQ_STR(live->featureIrOp, j.at(c, "feature_ir_op").kind == JsonValue::Kind::Null
                                        ? std::string() : j.text(c, "feature_ir_op"));
    // selection signature
    const JsonValue& sel = j.at(c, "selection");
    CHECK_EQ_STR(std::string(toString(live->signature.kind)), lower(j.text(sel, "kind")));
    CHECK_EQ_INT(live->signature.minCount, static_cast<long long>(j.num(sel, "min")));
    const bool unbounded = j.at(sel, "max").kind == JsonValue::Kind::Null;
    if (unbounded) {
      CHECK(live->signature.maxCount == static_cast<std::size_t>(-1));
    } else {
      CHECK_EQ_INT(live->signature.maxCount, static_cast<long long>(j.num(sel, "max")));
    }
    if (j.has(sel, "require_homogeneous")) {
      CHECK_EQ_INT(live->signature.requireHomogeneous ? 1 : 0,
                   j.at(sel, "require_homogeneous").boolean ? 1 : 0);
    }
    // parameter schema, in order
    const JsonValue& schema = j.at(c, "parameters");
    CHECK_EQ_INT(live->schema.size(), schema.items.size());
    for (std::size_t k = 0; k < live->schema.size() && k < schema.items.size(); ++k) {
      const ParamSpec& p = live->schema[k];
      const JsonValue& q = j.at(schema, k);
      CHECK_EQ_STR(p.name, j.text(q, "name"));
      CHECK_EQ_STR(std::string(paramTypeName(p.type)), j.text(q, "type"));
      CHECK_EQ_INT(p.required ? 1 : 0, j.at(q, "required").boolean ? 1 : 0);
      CHECK_NEAR(p.defaultNumber, j.num(q, "default_number"), 1e-12);
      CHECK_EQ_STR(p.defaultText, j.text(q, "default_text"));
      CHECK_EQ_INT(p.hasDefault ? 1 : 0, j.at(q, "has_default").boolean ? 1 : 0);
    }
  }

  // ── 3. every allowed op is an op forge::ui can validate ──────────────────
  const JsonValue& ops = j.at(doc, "ops");
  CHECK_EQ_INT(ops.items.size(), static_cast<long long>(j.num(counts, "user_invocable_ops")));
  for (std::size_t i = 0; i < ops.items.size(); ++i) {
    const JsonValue& o = j.at(ops, i);
    const std::string name = j.text(o, "op");
    const IrOpSpec* spec = findIrOp(name);
    CHECK(spec != nullptr);
    if (spec == nullptr) {
      std::printf("  FAIL vocabulary allows op %s that forge::ui does not know\n", name.c_str());
      continue;
    }
    const JsonValue& arity = j.at(o, "arity");
    CHECK_EQ_INT(spec->minArgs, static_cast<long long>(j.num(arity, "min_args")));
    if (j.at(arity, "max_args").kind == JsonValue::Kind::Null) {
      CHECK(spec->maxArgs == kIrArgsUnbounded);
    } else {
      CHECK_EQ_INT(spec->maxArgs, static_cast<long long>(j.num(arity, "max_args")));
    }
    CHECK_EQ_INT(spec->firstArgIsValueRef ? 1 : 0,
                 j.at(arity, "first_argument_is_value_ref").boolean ? 1 : 0);
    // and at least one live command names it
    bool named = false;
    for (const std::string& id : liveIds) {
      const CommandDescriptor* c = shell.registry().find(id);
      if (c != nullptr && c->featureIrOp == name) named = true;
    }
    CHECK(named);
  }

  // ── 4. no forbidden op is reachable from a command that emits ────────────
  const JsonValue& forbidden = j.at(doc, "forbidden_ops");
  CHECK_EQ_INT(forbidden.items.size(), static_cast<long long>(j.num(counts, "forbidden_ops")));
  for (std::size_t i = 0; i < forbidden.items.size(); ++i) {
    const std::string name = j.text(j.at(forbidden, i), "op");
    CHECK(findIrOp(name) != nullptr);  // it IS a kernel op ...
    for (std::size_t k = 0; k < ops.items.size(); ++k) {
      CHECK(j.text(j.at(ops, k), "op") != name);  // ... and it is NOT allowed
    }
  }

  // ── 5. every example is dispatched, and must record what the file says ───
  std::size_t examplesRun = 0;
  for (std::size_t i = 0; i < ops.items.size(); ++i) {
    const JsonValue& o = j.at(ops, i);
    const std::string opName = j.text(o, "op");
    const JsonValue& forms = j.at(o, "emitted_forms");
    for (std::size_t f = 0; f < forms.items.size(); ++f) {
      const JsonValue& form = j.at(forms, f);
      const std::string cmdId = j.text(form, "command");
      const JsonValue& examples = j.at(form, "examples");
      for (std::size_t e = 0; e < examples.items.size(); ++e) {
        const JsonValue& ex = j.at(examples, e);
        Fixture fx;
        CHECK(fx.seeded());
        const CommandDescriptor* c = fx.registry.find(cmdId);
        CHECK(c != nullptr);
        if (c == nullptr) continue;
        fx.selection.replaceWith(selectionFor(*c));

        CommandParams params;
        const JsonValue& ps = j.at(ex, "parameters");
        for (const auto& field : ps.fields) {
          const JsonValue& v = j.node(field.second);
          const ParamSpec* spec = nullptr;
          for (const ParamSpec& s : c->schema) {
            if (s.name == field.first) spec = &s;
          }
          CHECK(spec != nullptr);
          if (spec == nullptr) continue;
          switch (spec->type) {
            case ParamType::Number: params.setNumber(field.first, v.number); break;
            case ParamType::Text:   params.setText(field.first, v.str); break;
            case ParamType::Flag:   params.setFlag(field.first, v.boolean); break;
          }
        }

        const DispatchResult r = fx.registry.dispatch(cmdId, fx.selection, params);
        CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::Ok));
        if (!r.ok()) {
          std::printf("  FAIL %s example %zu refused: %s (%s)\n", cmdId.c_str(), e,
                      toString(r.status), r.detail.c_str());
          continue;
        }
        const FeatureRecord* rec = fx.doc.lastFeature();
        CHECK(rec != nullptr);
        if (rec == nullptr) continue;
        CHECK_EQ_STR(rec->line.op, opName);
        // the statement the document recorded must be legal IR, not merely text
        CHECK_EQ_INT(static_cast<int>(validateIr(rec->line)), static_cast<int>(IrCheck::Ok));

        std::string want;
        const JsonValue& args = j.at(ex, "ir_arguments");
        for (std::size_t k = 0; k < args.items.size(); ++k) {
          if (k != 0) want += ", ";
          want += resolvePlaceholder(j.at(args, k).str);
        }
        CHECK_EQ_STR(joinTokens(rec->line.args), want);
        ++examplesRun;
      }
    }
  }
  CHECK(examplesRun >= 25);
  std::printf("  [info] dispatched %zu recorded examples through the live registry\n",
              examplesRun);

  // ── 6. the recorded defects are still real ──────────────────────────────
  // A defect list nobody drives is a list that goes stale in the SAFE direction
  // (fixed, still listed) and the unsafe one (worded for code that moved).
  const JsonValue& defects = j.at(doc, "derived_defects");
  CHECK_EQ_INT(defects.items.size(), static_cast<long long>(j.num(counts, "derived_defects")));
  std::size_t drivenDefects = 0;
  for (std::size_t i = 0; i < defects.items.size(); ++i) {
    const JsonValue& d = j.at(defects, i);
    if (j.text(d, "kind") != "declares_an_op_it_never_emits") continue;
    const std::string cmdId = j.text(d, "command");
    const CommandDescriptor* c = shell.registry().find(cmdId);
    CHECK(c != nullptr);
    if (c == nullptr) continue;
    CHECK(!c->featureIrOp.empty());
    // No ForgeShell modelling stub may appear in this list any more: model.extrude,
    // model.fillet and model.shell are retired and the keymap reaches part.* --
    // which do emit. Only edit.delete is left declaring an op it never emits.
    CHECK(cmdId.rfind("model.", 0) != 0);
    CHECK_EQ_STR(cmdId, "edit.delete");
    // dispatch it against the SAME PartDocument the Part commands write to
    const std::size_t before = partDoc.featureCount();
    SelectionService sel;
    sel.replaceWith(selectionFor(*c));
    CommandParams p;
    for (const ParamSpec& s : c->schema) {
      if (s.type == ParamType::Number) p.setNumber(s.name, 12.0);
    }
    const DispatchResult r = shell.registry().dispatch(cmdId, sel, p);
    CHECK_EQ_INT(static_cast<int>(r.status), static_cast<int>(DispatchStatus::Ok));
    CHECK_EQ_INT(partDoc.featureCount(), before);  // reported success, recorded nothing
    ++drivenDefects;
  }
  CHECK_EQ_INT(drivenDefects, 1);  // edit.delete, and nothing else
  for (const std::string& id : shell.registry().ids()) {
    CHECK(id.rfind("model.", 0) != 0);
  }

  return H.finish();
}
