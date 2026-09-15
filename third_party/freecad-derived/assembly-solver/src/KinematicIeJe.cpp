/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#include "KinematicIeJe.h"
#include "EndFramec.h"

using namespace MbD;

KinematicIeJe::KinematicIeJe()
{
}

KinematicIeJe::KinematicIeJe(EndFrmsptr frmi, EndFrmsptr frmj) : ItemIJ(frmi, frmj)
{
}

bool MbD::KinematicIeJe::isKineIJ()
{
    return true;
}

void MbD::KinematicIeJe::calc_pvaluepXI()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluepEI()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpXI()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpEI()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEIpEI()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluepXJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluepEJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpXJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpEJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEIpXJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEIpEJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXJpXJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXJpEJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEJpEJ()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluepXK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluepEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEIpEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXJpEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEJpEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEKpEK()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_pvaluept()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvalueptpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_value()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXIpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEIpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXJpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEJpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepXKpt()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::KinematicIeJe::calc_ppvaluepEKpt()
{
    throw SimulationStoppingError("To be implemented.");
}

FRowDsptr MbD::KinematicIeJe::pvaluepXI()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::pvaluepEI()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXIpXI()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXIpEI()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEIpEI()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FRowDsptr MbD::KinematicIeJe::pvaluepXJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::pvaluepEJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXIpXJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXIpEJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEIpXJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEIpEJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXJpXJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXJpEJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEJpEJ()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FRowDsptr MbD::KinematicIeJe::pvaluepXK()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::pvaluepEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXIpEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEIpEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepXJpEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEJpEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

FMatDsptr MbD::KinematicIeJe::ppvaluepEKpEK()
{
    throw SimulationStoppingError("To be implemented.");
    return FMatDsptr();
}

double MbD::KinematicIeJe::pvaluept()
{
    throw SimulationStoppingError("To be implemented.");
    return 0.0;
}

double MbD::KinematicIeJe::ppvalueptpt()
{
    throw SimulationStoppingError("To be implemented.");
    return 0.0;
}

FRowDsptr MbD::KinematicIeJe::ppvaluepXIpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::ppvaluepEIpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::ppvaluepXJpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::ppvaluepEJpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::ppvaluepXKpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

FRowDsptr MbD::KinematicIeJe::ppvaluepEKpt()
{
    throw SimulationStoppingError("To be implemented.");
    return FRowDsptr();
}

double MbD::KinematicIeJe::value()
{
    throw SimulationStoppingError("To be implemented.");
    return 0.0;
}
