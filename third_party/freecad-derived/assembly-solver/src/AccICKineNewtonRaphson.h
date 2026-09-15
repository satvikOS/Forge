/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "AccICNewtonRaphson.h"

namespace MbD {
    class AccICKineNewtonRaphson : public AccICNewtonRaphson
    {
        //Kinematics with under constrained system
    public:
        void initializeGlobally() override;
        void preRun() override;


    };
}

