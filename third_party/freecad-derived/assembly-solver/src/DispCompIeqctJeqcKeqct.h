/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
 
#pragma once

#include "DispCompIeqcJeqcKeqct.h"

namespace MbD {
    class DispCompIeqctJeqcKeqct : public DispCompIeqcJeqcKeqct
    {
        //
    public:
        DispCompIeqctJeqcKeqct();
        DispCompIeqctJeqcKeqct(EndFrmsptr frmi, EndFrmsptr frmj, EndFrmsptr frmk, size_t axisk);

        void preAccIC() override;
        void preVelIC() override;

    };
}

