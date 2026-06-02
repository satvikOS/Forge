#include "forge/GltfExport.hpp"

#include "forge/Tessellate.hpp"

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Poly_Triangulation.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <limits>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace forge { namespace gltf {

namespace {

constexpr std::uint32_t GLB_MAGIC = 0x46546C67u;        // 'glTF'
constexpr std::uint32_t GLB_VERSION = 2u;
constexpr std::uint32_t JSON_CHUNK_TYPE = 0x4E4F534Au; // 'JSON'
constexpr std::uint32_t BIN_CHUNK_TYPE  = 0x004E4942u; // 'BIN\0'
constexpr std::uint32_t COMPONENT_FLOAT = 5126u;
constexpr std::uint32_t COMPONENT_UINT32 = 5125u;
constexpr std::uint32_t TARGET_ARRAY_BUFFER = 34962u;
constexpr std::uint32_t TARGET_ELEMENT_ARRAY_BUFFER = 34963u;

// 4-byte alignment padding (with ASCII space for JSON, 0x00 for BIN).
std::size_t padToFour(std::size_t n, char pad, std::vector<char>& buf) {
    while (n % 4 != 0) { buf.push_back(pad); ++n; }
    return n;
}

// Tessellate a single BREP handle into interleaved float arrays.
struct MeshArrays {
    std::vector<float> positions;
    std::vector<float> normals;
    std::vector<std::uint32_t> indices;
    float bboxMin[3] = { 0, 0, 0 };
    float bboxMax[3] = { 0, 0, 0 };
};

MeshArrays tessellateForGltf(ShapeHandle h, double defl, double angDefl,
                              bool computeNormals) {
    // Reuse the existing tessellate() interface — it already returns
    // float arrays in model units (mm).
    auto mesh = tessellate(h, defl, angDefl);
    MeshArrays out;
    out.positions = mesh.positions;
    if (computeNormals && !mesh.normals.empty()) {
        out.normals = mesh.normals;
    }
    out.indices = mesh.indices;
    // Bounding box.
    if (!out.positions.empty()) {
        out.bboxMin[0] = out.bboxMax[0] = out.positions[0];
        out.bboxMin[1] = out.bboxMax[1] = out.positions[1];
        out.bboxMin[2] = out.bboxMax[2] = out.positions[2];
        for (std::size_t i = 0; i + 2 < out.positions.size(); i += 3) {
            for (int k = 0; k < 3; ++k) {
                if (out.positions[i + k] < out.bboxMin[k]) out.bboxMin[k] = out.positions[i + k];
                if (out.positions[i + k] > out.bboxMax[k]) out.bboxMax[k] = out.positions[i + k];
            }
        }
    }
    return out;
}

std::string fmtVec3(const float* v) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "[%.6g,%.6g,%.6g]", v[0], v[1], v[2]);
    return std::string(buf);
}

std::string fmtVec4(double r, double g, double b, double a) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "[%.4f,%.4f,%.4f,%.4f]", r, g, b, a);
    return std::string(buf);
}

} // anonymous namespace

ExportSummary writeGlb(const std::vector<ExportBody>& bodies,
                       const std::string& filepath,
                       const ExportOptions& options) {
    if (bodies.empty()) {
        throw std::invalid_argument("forge.gltf: no bodies to export");
    }
    if (filepath.empty()) {
        throw std::invalid_argument("forge.gltf: filepath required");
    }

    // ----------------------- 1. Tessellate every body
    std::vector<MeshArrays> meshes;
    meshes.reserve(bodies.size());
    for (const auto& b : bodies) {
        meshes.push_back(tessellateForGltf(
            b.handle, options.deflection, options.angularDeflection,
            options.computeNormals));
    }

    // ----------------------- 2. Build binary chunk + JSON accessors
    std::vector<char> bin;
    bin.reserve(1024 * 1024);
    // Each mesh contributes 3 accessors (positions, normals, indices) and
    // 3 bufferViews. Index 0 of each mesh's accessor triplet is positions.
    struct AccessorSpec {
        std::uint32_t bufferView;
        std::uint32_t componentType;
        std::uint32_t count;
        std::string   type;         // "VEC3" or "SCALAR"
        bool          hasBounds;
        float         vmin[3];
        float         vmax[3];
    };
    std::vector<AccessorSpec> accessors;
    struct BufferViewSpec {
        std::uint32_t byteOffset;
        std::uint32_t byteLength;
        std::uint32_t target;
    };
    std::vector<BufferViewSpec> bufferViews;

    ExportSummary S{};
    S.bodiesWritten = static_cast<std::uint32_t>(bodies.size());

    for (const auto& m : meshes) {
        const std::uint32_t vCount = static_cast<std::uint32_t>(m.positions.size() / 3);
        const std::uint32_t iCount = static_cast<std::uint32_t>(m.indices.size());
        S.verticesTotal  += vCount;
        S.trianglesTotal += iCount / 3;

        // positions (VEC3 float)
        const std::uint32_t posOffset = static_cast<std::uint32_t>(bin.size());
        const std::uint32_t posLen = vCount * 12;
        bin.resize(posOffset + posLen);
        std::memcpy(bin.data() + posOffset, m.positions.data(), posLen);
        bufferViews.push_back({ posOffset, posLen, TARGET_ARRAY_BUFFER });
        AccessorSpec aPos;
        aPos.bufferView = static_cast<std::uint32_t>(bufferViews.size() - 1);
        aPos.componentType = COMPONENT_FLOAT;
        aPos.count = vCount;
        aPos.type = "VEC3";
        aPos.hasBounds = vCount > 0;
        std::memcpy(aPos.vmin, m.bboxMin, sizeof(aPos.vmin));
        std::memcpy(aPos.vmax, m.bboxMax, sizeof(aPos.vmax));
        accessors.push_back(aPos);
        // Pad bin to 4 bytes
        while (bin.size() % 4 != 0) bin.push_back(0);

        // normals (VEC3 float) — optional
        if (!m.normals.empty()) {
            const std::uint32_t normOffset = static_cast<std::uint32_t>(bin.size());
            const std::uint32_t normLen = vCount * 12;
            bin.resize(normOffset + normLen);
            std::memcpy(bin.data() + normOffset, m.normals.data(), normLen);
            bufferViews.push_back({ normOffset, normLen, TARGET_ARRAY_BUFFER });
            AccessorSpec aN;
            aN.bufferView = static_cast<std::uint32_t>(bufferViews.size() - 1);
            aN.componentType = COMPONENT_FLOAT;
            aN.count = vCount;
            aN.type = "VEC3";
            aN.hasBounds = false;
            accessors.push_back(aN);
            while (bin.size() % 4 != 0) bin.push_back(0);
        }

        // indices (SCALAR uint32)
        const std::uint32_t idxOffset = static_cast<std::uint32_t>(bin.size());
        const std::uint32_t idxLen = iCount * 4;
        bin.resize(idxOffset + idxLen);
        std::memcpy(bin.data() + idxOffset, m.indices.data(), idxLen);
        bufferViews.push_back({ idxOffset, idxLen, TARGET_ELEMENT_ARRAY_BUFFER });
        AccessorSpec aI;
        aI.bufferView = static_cast<std::uint32_t>(bufferViews.size() - 1);
        aI.componentType = COMPONENT_UINT32;
        aI.count = iCount;
        aI.type = "SCALAR";
        aI.hasBounds = false;
        accessors.push_back(aI);
        while (bin.size() % 4 != 0) bin.push_back(0);
    }

    // ----------------------- 3. Build JSON header
    std::ostringstream json;
    json.precision(8);
    json << "{\"asset\":{\"version\":\"2.0\",\"generator\":\""
         << options.generator << "\"}";
    json << ",\"scene\":0,\"scenes\":[{\"nodes\":[";
    for (std::size_t i = 0; i < bodies.size(); ++i) {
        if (i) json << ',';
        json << i;
    }
    json << "]}]";

    // Nodes — one per body, each referencing its mesh.
    json << ",\"nodes\":[";
    for (std::size_t i = 0; i < bodies.size(); ++i) {
        if (i) json << ',';
        json << "{\"mesh\":" << i << ",\"name\":\""
             << bodies[i].name << "\"}";
    }
    json << "]";

    // Meshes — one per body, each referencing its accessor triplet.
    // The accessor indices per mesh are accumulated above (3 per body when
    // normals present, 2 when absent). Recompute the per-mesh accessor
    // base.
    json << ",\"meshes\":[";
    std::size_t accBase = 0;
    for (std::size_t i = 0; i < bodies.size(); ++i) {
        if (i) json << ',';
        const bool hasN = !meshes[i].normals.empty();
        const std::size_t accPos = accBase;
        const std::size_t accNorm = hasN ? accBase + 1 : 0;
        const std::size_t accIdx = accBase + (hasN ? 2 : 1);
        json << "{\"primitives\":[{\"attributes\":{\"POSITION\":" << accPos;
        if (hasN) json << ",\"NORMAL\":" << accNorm;
        json << "},\"indices\":" << accIdx << ",\"material\":" << i << "}]}";
        accBase += (hasN ? 3 : 2);
    }
    json << "]";

    // Materials — PBR metallic-roughness, one per body.
    json << ",\"materials\":[";
    for (std::size_t i = 0; i < bodies.size(); ++i) {
        if (i) json << ',';
        const auto& b = bodies[i];
        json << "{\"name\":\"" << b.name << "_mat\""
             << ",\"pbrMetallicRoughness\":{"
             << "\"baseColorFactor\":" << fmtVec4(b.baseColorR, b.baseColorG,
                                                    b.baseColorB, b.baseColorA)
             << ",\"metallicFactor\":"  << b.metallicFactor
             << ",\"roughnessFactor\":" << b.roughnessFactor
             << "}}";
    }
    json << "]";

    // Accessors.
    json << ",\"accessors\":[";
    for (std::size_t i = 0; i < accessors.size(); ++i) {
        const auto& a = accessors[i];
        if (i) json << ',';
        json << "{\"bufferView\":" << a.bufferView
             << ",\"componentType\":" << a.componentType
             << ",\"count\":" << a.count
             << ",\"type\":\"" << a.type << "\"";
        if (a.hasBounds) {
            json << ",\"min\":" << fmtVec3(a.vmin)
                 << ",\"max\":" << fmtVec3(a.vmax);
        }
        json << "}";
    }
    json << "]";

    // BufferViews.
    json << ",\"bufferViews\":[";
    for (std::size_t i = 0; i < bufferViews.size(); ++i) {
        const auto& v = bufferViews[i];
        if (i) json << ',';
        json << "{\"buffer\":0,\"byteOffset\":" << v.byteOffset
             << ",\"byteLength\":" << v.byteLength
             << ",\"target\":" << v.target << "}";
    }
    json << "]";

    // Single buffer.
    json << ",\"buffers\":[{\"byteLength\":" << bin.size() << "}]}";

    std::string jsonStr = json.str();
    // Pad JSON with spaces to 4-byte alignment.
    while (jsonStr.size() % 4 != 0) jsonStr.push_back(' ');

    // ----------------------- 4. Write .glb
    const std::uint32_t jsonChunkLen = static_cast<std::uint32_t>(jsonStr.size());
    const std::uint32_t binChunkLen  = static_cast<std::uint32_t>(bin.size());
    const std::uint32_t totalLen = 12  // header
                                 + 8 + jsonChunkLen
                                 + 8 + binChunkLen;
    std::ofstream f(filepath, std::ios::binary);
    if (!f) throw std::runtime_error("forge.gltf: cannot open " + filepath);
    auto wU32 = [&](std::uint32_t v) {
        f.write(reinterpret_cast<const char*>(&v), 4);
    };
    wU32(GLB_MAGIC);
    wU32(GLB_VERSION);
    wU32(totalLen);
    wU32(jsonChunkLen);
    wU32(JSON_CHUNK_TYPE);
    f.write(jsonStr.data(), jsonStr.size());
    wU32(binChunkLen);
    wU32(BIN_CHUNK_TYPE);
    if (!bin.empty()) f.write(bin.data(), bin.size());
    if (!f) throw std::runtime_error("forge.gltf: write failed for " + filepath);
    f.close();

    S.fileSizeBytes = totalLen;
    return S;
}

}} // namespace forge::gltf
