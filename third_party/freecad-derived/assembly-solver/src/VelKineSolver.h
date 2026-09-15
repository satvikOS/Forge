/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "VelSolver.h"

namespace MbD {
    class VelKineSolver : public VelSolver
    {
        //Kinematics with fully constrained system
    public:
        void assignEquationNumbers() override;
        void run() override;

    };
}

