/***************************************************************************
 *   Copyright (c) 2023 Ondsel, Inc.                                       *
 *                                                                         *
 *   This file is part of OndselSolver.                                    *
 *                                                                         *
 *   See LICENSE file for details about copyright.                         *
 ***************************************************************************/
// SPDX-License-Identifier: LGPL-2.1-only
//
// MODIFIED for Forge (ArchDisc), 2026-09-15 -- see ../MODIFICATIONS.md.
// The redundant-constraint retry loop is bounded: a pass that removes no new constraint is a SimulationStoppingError instead of an endless loop.

#include <assert.h>
#include <exception>

#include "PosICNewtonRaphson.h"
#include "SingularMatrixError.h"
#include "SystemSolver.h"
#include "Part.h"
#include "Constraint.h"
#include "CREATE.h"
#include "GESpMatParPvPrecise.h"
#include "GESpMatFullPvPosIC.h"
#include "System.h"
#include "SimulationStoppingError.h"

using namespace MbD;

void PosICNewtonRaphson::run()
{
	// Forge: this loop used to be unbounded. Each pass that ends in a singular
	// matrix marks the offending equations redundant and starts again, so a pass
	// that marks NOTHING new can never make progress -- and would spin for ever
	// inside an interactive application. It is now a refusal instead.
	std::size_t redundantBefore = system->system->allRedundantConstraints()->size();
	while (true) {
		try {
			//VectorNewtonRaphson::run();   //Inline to help debugging
			preRun();
			initializeLocally();
			initializeGlobally();
			iterate();
			postRun();
			break;
		}
		catch (const SingularMatrixError& ex) {
			auto redundantEqnNos = ex.getRedundantEqnNos();
			system->partsJointsMotionsLimitsDo([&](std::shared_ptr<Item> item) { item->removeRedundantConstraints(redundantEqnNos); });
			const std::size_t redundantAfter = system->system->allRedundantConstraints()->size();
			if (redundantAfter <= redundantBefore) {
				throw SimulationStoppingError("the constraint equations are singular and no redundant constraint could be removed");
			}
			redundantBefore = redundantAfter;
			system->partsJointsMotionsLimitsDo([&](std::shared_ptr<Item> item) { item->constraintsReport(); });
			system->partsJointsMotionsLimitsDo([&](std::shared_ptr<Item> item) { item->setqsu(qsuOld); });
		}
	}
}

void PosICNewtonRaphson::preRun()
{
	std::string str("MbD: Assembling system. ");
	system->logString(str);
	PosNewtonRaphson::preRun();
}

void PosICNewtonRaphson::assignEquationNumbers()
{
	auto parts = system->parts();
	//auto contactEndFrames = system->contactEndFrames();
	//auto uHolders = system->uHolders();
	auto essentialConstraints = system->essentialConstraints();
	auto displacementConstraints = system->displacementConstraints();
	auto perpendicularConstraints = system->perpendicularConstraints();
	size_t eqnNo = 0;
	for (auto& part : *parts) {
		part->iqX(eqnNo);
		eqnNo = eqnNo + 3;
		part->iqE(eqnNo);
		eqnNo = eqnNo + 4;
	}
	//for (auto& endFrm : *contactEndFrames) {
	//	endFrm->is(eqnNo);
	//	eqnNo = eqnNo + endFrm->sSize();
	//}
	//for (auto& uHolder : *uHolders) {
	//	uHolder->iu(eqnNo);
	//	eqnNo += 1;
	//}
	auto nEqns = eqnNo;	//C++ uses index 0.
	nqsu = nEqns;
	for (auto& con : *essentialConstraints) {
		con->iG = eqnNo;
		eqnNo += 1;
	}
	auto lastEssenConEqnNo = eqnNo - 1;
	for (auto& con : *displacementConstraints) {
		con->iG = eqnNo;
		eqnNo += 1;
	}
	auto lastDispConEqnNo = eqnNo - 1;
	for (auto& con : *perpendicularConstraints) {
		con->iG = eqnNo;
		eqnNo += 1;
	}
	auto lastEqnNo = eqnNo - 1;
	nEqns = eqnNo;	//C++ uses index 0.
	n = nEqns;
	auto rangelimits = { lastEssenConEqnNo + 1, lastDispConEqnNo + 1, lastEqnNo + 1 };
	pivotRowLimits = std::make_shared<std::vector<size_t>>(rangelimits);
}

bool PosICNewtonRaphson::isConverged()
{
	return this->isConvergedToNumericalLimit();
}

void PosICNewtonRaphson::handleSingularMatrix()
{
	nSingularMatrixError++;
	if (nSingularMatrixError == 1) {
		this->lookForRedundantConstraints();
		matrixSolver = this->matrixSolverClassNew();
	}
	else {
        auto& r = *matrixSolver;
		std::string str = typeid(r).name();
		if (str.find("GESpMatParPvMarkoFast") != std::string::npos) {
		    matrixSolver = CREATE<GESpMatParPvPrecise>::With();
		    this->solveEquations();
		}
		else {
            auto& msRef = *matrixSolver.get(); // extrapolated to suppress warning
            str = typeid(msRef).name();
            (void) msRef;                      // also for warning suppression
			if (str.find("GESpMatParPvPrecise") != std::string::npos) {
				this->lookForRedundantConstraints();
				matrixSolver = this->matrixSolverClassNew();
			} else {
				throw SimulationStoppingError("To be implemented.");
			}
		}
	}
}

void PosICNewtonRaphson::lookForRedundantConstraints()
{
	std::string str("MbD: Checking for redundant constraints.");
	system->logString(str);
	auto posICsolver = CREATE<GESpMatFullPvPosIC>::With();
	posICsolver->system = this;
	dx = posICsolver->solvewithsaveOriginal(pypx, y->negated(), false);
}
