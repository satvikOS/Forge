/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#pragma once

#include "Function.h"

namespace MbD {
    class Symbolic;
    //using Symsptr = Symsptr;

    class FunctionXY : public Function
    {
        //x y 
    public:
        FunctionXY();
        FunctionXY(Symsptr base, Symsptr exp);
        virtual Symsptr copyWith(Symsptr argx, Symsptr argy) = 0;
        Symsptr expandUntil(Symsptr sptr, std::shared_ptr<std::unordered_set<Symsptr>> set) override;
        Symsptr simplifyUntil(Symsptr sptr, std::shared_ptr<std::unordered_set<Symsptr>> set) override;
        void arguments(Symsptr args) override;
        void createMbD(std::shared_ptr<System> mbdSys, std::shared_ptr<Units> mbdUnits) override;
        Symsptr differentiateWRT(Symsptr var) override;
        virtual Symsptr differentiateWRTx() = 0;
        virtual Symsptr differentiateWRTy() = 0;
        bool isConstant() override;

        Symsptr x, y;

    };
}

