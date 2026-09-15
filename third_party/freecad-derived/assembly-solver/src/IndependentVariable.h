/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "Variable.h"

namespace MbD {
    class IndependentVariable : public Variable
    {
    public:
        IndependentVariable();
        Symsptr differentiateWRT(Symsptr var) override;
    };
}

