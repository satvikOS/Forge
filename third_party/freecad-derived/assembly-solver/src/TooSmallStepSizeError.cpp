/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#include "TooSmallStepSizeError.h"

using namespace MbD;

TooSmallStepSizeError::TooSmallStepSizeError(const std::string& msg) : std::runtime_error(msg)
{
}
