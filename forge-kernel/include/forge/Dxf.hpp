#pragma once

// Forge-207 — DXF (AutoCAD) ASCII reader + writer.
//
// Supports LINE, CIRCLE, ARC and LWPOLYLINE entities on arbitrary
// layers. The DXF group-code format is (code\nvalue\n)* pairs;
// entities live inside the ENTITIES section.

#include <cstdint>
#include <string>
#include <vector>

namespace forge { namespace dxf {

enum class EntityType : std::uint8_t {
    Line, Circle, Arc, LwPolyline,
};

struct Entity {
    EntityType  type;
    std::string layer;          // empty ⇒ "0"
    double      x0, y0;         // start (line) / centre (circle/arc)
    double      x1, y1;         // end (line) — unused for others
    double      radius;
    double      startAngleDeg;  // arc only
    double      endAngleDeg;    // arc only
    std::vector<double> vertices;  // x0,y0, x1,y1, … for LWPOLYLINE
    bool        closed;
};

struct Document {
    std::vector<Entity> entities;
};

Document parse(const std::string& text);
std::string write(const Document& doc);

}} // namespace forge::dxf
