#include "forge/Dxf.hpp"

#include <cctype>
#include <cstdlib>
#include <sstream>
#include <stdexcept>
#include <string>

namespace forge { namespace dxf {

namespace {

std::string trim(const std::string& s) {
    std::size_t a = 0, b = s.size();
    while (a < b && (s[a] == ' ' || s[a] == '\t' || s[a] == '\r')) ++a;
    while (b > a && (s[b-1] == ' ' || s[b-1] == '\t' || s[b-1] == '\r')) --b;
    return s.substr(a, b - a);
}

bool nextPair(std::istringstream& in, int& code, std::string& value) {
    std::string codeLine, valLine;
    if (!std::getline(in, codeLine)) return false;
    if (!std::getline(in, valLine))  return false;
    codeLine = trim(codeLine);
    if (codeLine.empty()) return nextPair(in, code, value);
    code = std::atoi(codeLine.c_str());
    value = trim(valLine);
    return true;
}

} // namespace

Document parse(const std::string& text) {
    Document doc;
    std::istringstream in(text);
    int code; std::string val;
    bool inEntities = false;
    Entity cur{}; cur.layer = "0";
    bool collecting = false;
    auto pushIfReady = [&]() {
        if (collecting) {
            doc.entities.push_back(cur);
            cur = Entity{}; cur.layer = "0";
            collecting = false;
        }
    };

    while (nextPair(in, code, val)) {
        if (code == 0) {
            if (val == "SECTION") continue;
            if (val == "ENDSEC") { pushIfReady(); inEntities = false; continue; }
            if (val == "EOF") { pushIfReady(); break; }
            pushIfReady();
            if (!inEntities) continue;
            if (val == "LINE")        { cur.type = EntityType::Line;       collecting = true; }
            else if (val == "CIRCLE") { cur.type = EntityType::Circle;     collecting = true; }
            else if (val == "ARC")    { cur.type = EntityType::Arc;        collecting = true; }
            else if (val == "LWPOLYLINE") { cur.type = EntityType::LwPolyline; collecting = true; }
            else { collecting = false; }
            continue;
        }
        if (code == 2 && val == "ENTITIES") { inEntities = true; continue; }
        if (!collecting) continue;
        switch (code) {
            case  8: cur.layer = val; break;
            case 10: cur.x0 = std::atof(val.c_str());
                     if (cur.type == EntityType::LwPolyline) cur.vertices.push_back(cur.x0);
                     break;
            case 20: cur.y0 = std::atof(val.c_str());
                     if (cur.type == EntityType::LwPolyline) cur.vertices.push_back(cur.y0);
                     break;
            case 11: cur.x1 = std::atof(val.c_str()); break;
            case 21: cur.y1 = std::atof(val.c_str()); break;
            case 40: cur.radius = std::atof(val.c_str()); break;
            case 50: cur.startAngleDeg = std::atof(val.c_str()); break;
            case 51: cur.endAngleDeg   = std::atof(val.c_str()); break;
            case 70: cur.closed = (std::atoi(val.c_str()) & 1) != 0; break;
            default: break;
        }
    }
    pushIfReady();
    return doc;
}

std::string write(const Document& doc) {
    std::ostringstream out;
    auto pair = [&](int code, const std::string& v) {
        out << code << "\n" << v << "\n";
    };
    auto pairN = [&](int code, double v) {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "%.10g", v);
        pair(code, buf);
    };
    auto pairI = [&](int code, int v) {
        pair(code, std::to_string(v));
    };

    pair(0, "SECTION");
    pair(2, "ENTITIES");
    for (const auto& e : doc.entities) {
        switch (e.type) {
            case EntityType::Line:
                pair(0, "LINE"); pair(8, e.layer.empty() ? "0" : e.layer);
                pairN(10, e.x0); pairN(20, e.y0); pairN(30, 0);
                pairN(11, e.x1); pairN(21, e.y1); pairN(31, 0);
                break;
            case EntityType::Circle:
                pair(0, "CIRCLE"); pair(8, e.layer.empty() ? "0" : e.layer);
                pairN(10, e.x0); pairN(20, e.y0); pairN(30, 0);
                pairN(40, e.radius);
                break;
            case EntityType::Arc:
                pair(0, "ARC"); pair(8, e.layer.empty() ? "0" : e.layer);
                pairN(10, e.x0); pairN(20, e.y0); pairN(30, 0);
                pairN(40, e.radius);
                pairN(50, e.startAngleDeg);
                pairN(51, e.endAngleDeg);
                break;
            case EntityType::LwPolyline:
                pair(0, "LWPOLYLINE"); pair(8, e.layer.empty() ? "0" : e.layer);
                pairI(90, static_cast<int>(e.vertices.size() / 2));
                pairI(70, e.closed ? 1 : 0);
                for (std::size_t i = 0; i + 1 < e.vertices.size(); i += 2) {
                    pairN(10, e.vertices[i + 0]);
                    pairN(20, e.vertices[i + 1]);
                }
                break;
        }
    }
    pair(0, "ENDSEC");
    pair(0, "EOF");
    return out.str();
}

}} // namespace forge::dxf
