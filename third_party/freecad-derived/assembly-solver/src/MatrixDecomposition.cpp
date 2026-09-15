/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/

#include "MatrixDecomposition.h"

using namespace MbD;

FColDsptr MbD::MatrixDecomposition::forAndBackSubsaveOriginal(FColDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
	return FColDsptr();
}

void MatrixDecomposition::applyRowOrderOnRightHandSideB()
{
	FColDsptr answer = std::make_shared<FullColumn<double>>(m);
	for (size_t i = 0; i < m; i++)
	{
		answer->at(i) = rightHandSideB->at(rowOrder->at(i));
	}
	rightHandSideB = answer;
}

FColDsptr MbD::MatrixDecomposition::basicSolvewithsaveOriginal(FMatDsptr, FColDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
	return FColDsptr();
}

void MbD::MatrixDecomposition::forwardSubstituteIntoL()
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::MatrixDecomposition::backSubstituteIntoU()
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::MatrixDecomposition::forwardSubstituteIntoLD()
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::MatrixDecomposition::postSolve()
{
	throw SimulationStoppingError("To be implemented.");
}

void MbD::MatrixDecomposition::preSolvesaveOriginal(FMatDsptr, bool)
{
	throw SimulationStoppingError("To be implemented.");
}
