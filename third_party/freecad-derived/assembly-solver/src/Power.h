/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#pragma once

#include "FunctionXY.h"

namespace MbD {
    class Power : public FunctionXY
    {
        //
    public:
        Power();
        Power(Symsptr base, Symsptr exp);
        Symsptr differentiateWRTx() override;
        Symsptr differentiateWRTy() override;
        Symsptr copyWith(Symsptr argx, Symsptr argy) override;
        Symsptr clonesptr() override;
        Symsptr simplifyUntil(Symsptr sptr, std::shared_ptr<std::unordered_set<Symsptr>> set) override;
        double getValue() override;

        std::ostream& printOn(std::ostream& s) const override;

    };
}

