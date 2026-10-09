#include "forge/ShapeRegistry.hpp"

#ifdef FORGE_NATIVE_BREP
#include "forge/NativeOcctBridge.hpp"   // occtFromNativeSolid — lazy native→OCCT
#endif

#include <stdexcept>
#include <utility>
#include <vector>

namespace forge {

// Ownership, lifetime and lock rules: see the T-183 block in ShapeRegistry.hpp.

namespace {

// The innermost live Scope::Capture on this thread (a stack linked by prev_).
thread_local const ShapeRegistry::Scope::Capture* t_capture = nullptr;

}  // namespace

#ifdef FORGE_NATIVE_BREP
// One per native solid that get() has been asked for. The entry shares it; get()
// copies the shared_ptr under mtx_ and then works on it with mtx_ released, so a
// release() that erases the entry meanwhile cannot free it.
struct ShapeRegistry::OcctMemo {
    std::mutex mtx;      // serializes the conversion: one per memo, ever
    TopoDS_Shape shape;  // null until a conversion succeeded
};
#endif

ShapeRegistry& ShapeRegistry::instance() {
    static ShapeRegistry s;
    return s;
}

ShapeHandle ShapeRegistry::insert(Entry e) {
    std::lock_guard<std::mutex> g(mtx_);
    const ShapeHandle h = next_++;
    ScopeRefs* scope = nullptr;
    for (const Scope::Capture* c = t_capture; c != nullptr; c = c->prev_) {
        if (c->reg_ != this) continue;
        auto it = scopes_.find(c->scope_);
        if (it != scopes_.end()) scope = &it->second;
        break;  // the innermost capture on this registry decides, open or not
    }
    if (scope != nullptr) {
        e.refcount = 0;
        e.scopeRefs = 1;
        ++(*scope)[h];
    } else {
        e.refcount = 1;
        e.scopeRefs = 0;
    }
    entries_.emplace(h, std::move(e));
    ++totalEverIssued_;
    return h;
}

ShapeHandle ShapeRegistry::add(TopoDS_Shape shape) {
    Entry e;
    e.kind = ShapeKind::Occt;
    e.shape = std::move(shape);
    return insert(std::move(e));
}

ShapeKind ShapeRegistry::kindOf(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::kindOf — invalid handle");
    }
    return it->second.kind;
}

void ShapeRegistry::retain(ShapeHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::retain — invalid handle");
    }
    ++it->second.refcount;
}

void ShapeRegistry::release(ShapeHandle h) {
    Entry dead;  // destroyed AFTER the lock is dropped: payload destructors never run under mtx_
    {
        std::lock_guard<std::mutex> g(mtx_);
        auto it = entries_.find(h);
        if (it == entries_.end()) return;  // double-release is a no-op
        Entry& e = it->second;

        bool dropped = false;
        // 1. The build releasing a handle its own capture (or an enclosing one on
        //    this thread) holds: that Scope's reference.
        if (e.scopeRefs > 0) {
            for (const Scope::Capture* c = t_capture; c != nullptr && !dropped; c = c->prev_) {
                if (c->reg_ != this) continue;
                auto sit = scopes_.find(c->scope_);
                if (sit == scopes_.end()) continue;
                auto hit = sit->second.find(h);
                if (hit == sit->second.end()) continue;
                if (--hit->second == 0) sit->second.erase(hit);
                --e.scopeRefs;
                dropped = true;
            }
        }
        // 2. Otherwise a caller-owned reference.
        if (!dropped && e.refcount > 0) {
            --e.refcount;
            dropped = true;
        }
        // 3. Otherwise only Scope-owned references are left: not the caller's.
        if (!dropped) {
            refusedReleases_.fetch_add(1, std::memory_order_relaxed);
            return;
        }
        if (e.refcount != 0 || e.scopeRefs != 0) return;
        dead = std::move(e);
        entries_.erase(it);
    }
}

TopoDS_Shape ShapeRegistry::get(ShapeHandle h) const {
#ifdef FORGE_NATIVE_BREP
    std::shared_ptr<OcctMemo> memo;
    std::shared_ptr<native::brep::TopologyBuilder> owner;  // pins *solid while converting
    const native::brep::Solid* solid = nullptr;
#endif
    {
        std::lock_guard<std::mutex> g(mtx_);
        auto it = entries_.find(h);
        if (it == entries_.end()) {
            throw std::runtime_error("ShapeRegistry::get — invalid handle");
        }
        const Entry& e = it->second;
        if (e.kind == ShapeKind::Occt) {
            return e.shape;  // a copy: shared ownership of the TShape, taken under the lock
        }
#ifdef FORGE_NATIVE_BREP
        if (e.kind == ShapeKind::NativeSolid) {
            if (!e.occt) e.occt = std::make_shared<OcctMemo>();
            memo = e.occt;
            owner = e.owner;
            solid = e.solid;
        }
#endif
    }
#ifdef FORGE_NATIVE_BREP
    // LAZY native→OCCT BRIDGE. An OCCT-only op (heal/sheet-metal/weldments/...)
    // asked for the TopoDS_Shape of a native analytic handle. Materialize it ONCE
    // per entry via the validated analytic STEP round-trip and memoize it, so a
    // native body flows through every OCCT-only op without that op knowing the
    // backend. Bible §0: native-where-proven, OCCT everywhere else, never a hard
    // failure on a valid modelling request.
    //
    // T-183: under the entry's OWN memo mutex, with the registry lock RELEASED,
    // and COUNTED. Concurrent get()s of the same handle wait here for the one
    // conversion; every other registry call proceeds.
    if (memo) {
        std::lock_guard<std::mutex> mg(memo->mtx);
        if (memo->shape.IsNull()) {
            conversions_.fetch_add(1, std::memory_order_relaxed);
            memo->shape = occtFromNativeSolid(*solid);  // throws only on genuine failure
        }
        return memo->shape;
    }
#endif
    throw std::runtime_error(
        "ShapeRegistry::get — handle is native-mesh-backed (a faceted feature "
        "result has no analytic TopoDS_Shape); branch on kindOf() / use getNativeMesh");
}

std::size_t ShapeRegistry::liveCount() const {
    std::lock_guard<std::mutex> g(mtx_);
    return entries_.size();
}

std::size_t ShapeRegistry::totalEverIssued() const {
    std::lock_guard<std::mutex> g(mtx_);
    return totalEverIssued_;
}

std::uint64_t ShapeRegistry::nativeToOcctConversions() const noexcept {
    return conversions_.load(std::memory_order_relaxed);
}

std::uint64_t ShapeRegistry::refusedReleases() const noexcept {
    return refusedReleases_.load(std::memory_order_relaxed);
}

#ifdef FORGE_NATIVE_BREP
ShapeHandle ShapeRegistry::addNativeSolid(
        std::shared_ptr<native::brep::TopologyBuilder> owner,
        native::brep::Solid* solid) {
    if (!owner || !solid) {
        throw std::runtime_error("ShapeRegistry::addNativeSolid — null owner/solid");
    }
    Entry e;
    e.kind = ShapeKind::NativeSolid;
    e.owner = std::move(owner);
    e.solid = solid;
    return insert(std::move(e));
}

ShapeHandle ShapeRegistry::addNativeMesh(
        std::shared_ptr<native::mesh::HalfEdgeMesh> mesh) {
    if (!mesh) {
        throw std::runtime_error("ShapeRegistry::addNativeMesh — null mesh");
    }
    Entry e;
    e.kind = ShapeKind::NativeMesh;
    e.mesh = std::move(mesh);
    return insert(std::move(e));
}

NativeLease<native::brep::Solid> ShapeRegistry::getNativeSolid(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::getNativeSolid — invalid handle");
    }
    const Entry& e = it->second;
    if (e.kind != ShapeKind::NativeSolid || !e.solid || !e.owner) {
        throw std::runtime_error(
            "ShapeRegistry::getNativeSolid — handle is not a native analytic solid");
    }
    // Aliasing: shares ownership of the builder, points at the Solid it owns.
    return NativeLease<native::brep::Solid>(
        std::shared_ptr<const native::brep::Solid>(e.owner, e.solid));
}

NativeLease<native::mesh::HalfEdgeMesh> ShapeRegistry::getNativeMesh(ShapeHandle h) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto it = entries_.find(h);
    if (it == entries_.end()) {
        throw std::runtime_error("ShapeRegistry::getNativeMesh — invalid handle");
    }
    const Entry& e = it->second;
    if (e.kind != ShapeKind::NativeMesh || !e.mesh) {
        throw std::runtime_error(
            "ShapeRegistry::getNativeMesh — handle is not a native mesh result");
    }
    return NativeLease<native::mesh::HalfEdgeMesh>(e.mesh);
}
#endif // FORGE_NATIVE_BREP

// ───────────────────────────────── Scopes ────────────────────────────────────

std::uint64_t ShapeRegistry::openScope() {
    std::lock_guard<std::mutex> g(mtx_);
    const std::uint64_t id = nextScope_++;
    scopes_.emplace(id, ScopeRefs{});
    return id;
}

bool ShapeRegistry::holdInScope(std::uint64_t scope, ShapeHandle h) {
    std::lock_guard<std::mutex> g(mtx_);
    auto sit = scopes_.find(scope);
    auto it = entries_.find(h);
    if (sit == scopes_.end() || it == entries_.end()) return false;
    ++sit->second[h];
    ++it->second.scopeRefs;
    return true;
}

std::size_t ShapeRegistry::releaseScope(std::uint64_t scope, bool close) noexcept {
    std::vector<Entry> dead;  // destroyed after the lock is dropped
    std::size_t dropped = 0;
    try {
        std::lock_guard<std::mutex> g(mtx_);
        auto sit = scopes_.find(scope);
        if (sit == scopes_.end()) return 0;
        dead.reserve(sit->second.size());  // the only allocation: before anything changes
        ScopeRefs refs = std::move(sit->second);
        if (close) {
            scopes_.erase(sit);
        } else {
            sit->second.clear();
        }
        for (const auto& [h, n] : refs) {
            dropped += n;
            auto it = entries_.find(h);
            if (it == entries_.end()) continue;  // cannot happen: a Scope ref keeps it alive
            Entry& e = it->second;
            e.scopeRefs = e.scopeRefs >= n ? e.scopeRefs - n : 0;
            if (e.refcount == 0 && e.scopeRefs == 0) {
                dead.push_back(std::move(e));
                entries_.erase(it);
            }
        }
    } catch (...) {
        // Only dead.reserve() can throw (bad_alloc), before any state changed: the
        // Scope then keeps its references. noexcept: Scope's destructor calls this.
    }
    return dropped;
}

std::size_t ShapeRegistry::scopeSize(std::uint64_t scope) const {
    std::lock_guard<std::mutex> g(mtx_);
    auto sit = scopes_.find(scope);
    if (sit == scopes_.end()) return 0;
    std::size_t n = 0;
    for (const auto& kv : sit->second) n += kv.second;
    return n;
}

ShapeRegistry::Scope::Scope(ShapeRegistry& reg) : reg_(&reg), id_(reg.openScope()) {}

ShapeRegistry::Scope::~Scope() {
    if (id_ != 0) reg_->releaseScope(id_, /*close=*/true);
}

ShapeRegistry::Scope::Scope(Scope&& other) noexcept : reg_(other.reg_), id_(other.id_) {
    other.id_ = 0;
}

ShapeRegistry::Scope& ShapeRegistry::Scope::operator=(Scope&& other) noexcept {
    if (this != &other) {
        if (id_ != 0) reg_->releaseScope(id_, /*close=*/true);
        reg_ = other.reg_;
        id_ = other.id_;
        other.id_ = 0;
    }
    return *this;
}

bool ShapeRegistry::Scope::hold(ShapeHandle h) {
    return id_ != 0 && reg_->holdInScope(id_, h);
}

std::size_t ShapeRegistry::Scope::releaseAll() noexcept {
    return id_ != 0 ? reg_->releaseScope(id_, /*close=*/false) : 0;
}

std::size_t ShapeRegistry::Scope::size() const {
    return id_ != 0 ? reg_->scopeSize(id_) : 0;
}

ShapeRegistry::Scope::Capture ShapeRegistry::Scope::capture() noexcept {
    return Capture(reg_, id_);
}

ShapeRegistry::Scope::Capture::Capture(const ShapeRegistry* reg, std::uint64_t scope) noexcept
    : reg_(reg), scope_(scope), prev_(t_capture) {
    t_capture = this;
}

ShapeRegistry::Scope::Capture::~Capture() {
    t_capture = prev_;
}

} // namespace forge
