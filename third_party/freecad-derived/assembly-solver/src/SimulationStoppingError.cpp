/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "SimulationStoppingError.h"

using namespace MbD;

SimulationStoppingError::SimulationStoppingError(const std::string& msg) : std::runtime_error(msg)
{
}
