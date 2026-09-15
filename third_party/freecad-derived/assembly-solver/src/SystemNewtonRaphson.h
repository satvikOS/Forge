/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// MODIFIED for Forge (ArchDisc), 2026-09-15 -- see ../MODIFICATIONS.md.
// outputSpreadsheet() declaration removed.
 
#pragma once

#include "VectorNewtonRaphson.h"
#include "SparseMatrix.h"

namespace MbD {
    //class SparseMatrix;

    class SystemNewtonRaphson : public VectorNewtonRaphson
    {
        //
    public:
        void initializeGlobally() override;
        virtual void assignEquationNumbers() override = 0;
        virtual void createVectorsAndMatrices();
        std::shared_ptr<MatrixSolver> matrixSolverClassNew() override;
        void calcdxNorm() override;
        void basicSolveEquations() override;
        void handleSingularMatrix() override;

        SpMatDsptr pypx;
    };
}

