/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
 
#include "ASMTForceTorque.h"

using namespace MbD;

void MbD::ASMTForceTorque::updateFromMbD()
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTForceTorque::compareResults(AnalysisType)
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTForceTorque::outputResults(AnalysisType)
{
	throw SimulationStoppingError("To be implemented.");
}
