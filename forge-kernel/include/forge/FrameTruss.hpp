#pragma once

// Forge-205 — 3D truss linear-elastic analysis.
//
// 2-node axial-only truss elements (3 DOF per node, no bending). For
// each element, the local element stiffness is k_e = (EA/L), and the
// 6×6 global stiffness is k_e · cᵀ · c where c = [−l,−m,−n, l,m,n]
// is the direction cosine row (l, m, n = unit vector from node A to
// node B). The global stiffness K is assembled into a dense matrix
// and solved via Eigen LDLT after partitioning out the constrained
// DOFs. Per-element axial force = (EA/L)·(c · u_global).

#include <cstdint>
#include <vector>

namespace forge { namespace frame {

struct Node {
    double position[3];
    bool   fixed[3];           // tx, ty, tz fixed?
};

struct Element {
    std::uint32_t a, b;        // node indices
    double E;                  // Young's modulus
    double A;                  // cross-section area
};

struct NodeLoad {
    std::uint32_t node;
    double force[3];
};

struct Inputs {
    std::vector<Node>     nodes;
    std::vector<Element>  elements;
    std::vector<NodeLoad> loads;
};

struct Outputs {
    std::vector<double> displacements;   // 3 doubles per node (tx, ty, tz)
    std::vector<double> reactions;       // 3 doubles per node — only fixed
                                         // DOFs have non-zero entries
    std::vector<double> axialForce;      // one entry per element (+ = tension)
    std::vector<double> elementLength;   // one entry per element
    bool                singular;        // true if K_ff was singular
                                         // (mechanism / under-constrained)
};

Outputs solve(const Inputs& in);

// Forge-210 — modal / vibration analysis.
//
// Generalised eigenvalue problem Kφ = ω²Mφ on the free-DOF partition.
// Mass matrix is lumped: each truss element of length L, area A, and
// density ρ contributes ρ·A·L / 2 to each of its end-nodes' tx/ty/tz
// rows. Returns the lowest `kModes` natural frequencies (Hz) and
// their mode-shape vectors (displacement per DOF, normalised so the
// largest entry = 1).

struct ModalElement {
    std::uint32_t a, b;
    double E;
    double A;
    double density;   // mass per unit volume; ρ
};

struct ModalInputs {
    std::vector<Node>         nodes;
    std::vector<ModalElement> elements;
    std::uint32_t             kModes;
};

struct ModalOutputs {
    std::vector<double>              frequenciesHz;   // size = kModes
    std::vector<std::vector<double>> modeShapes;      // kModes × dofs
};

ModalOutputs modal(const ModalInputs& in);

}} // namespace forge::frame
