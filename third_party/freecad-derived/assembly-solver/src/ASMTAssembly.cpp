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
// The .asmt file reader/writer, the demo and dragging-log test entry points and the debug file dumps are removed; solver messages are collected, not printed.

#include <string>
#include <cassert>
#include <algorithm>
#include <numeric>
#include <cmath>

#include "ASMTAssembly.h"
#include "CREATE.h"
#include "ASMTMarker.h"
#include "ASMTPart.h"
#include "ASMTJoint.h"
#include "ASMTMotion.h"
#include "ASMTPrincipalMassMarker.h"
#include "ASMTForceTorque.h"
#include "ASMTConstantGravity.h"
#include "ASMTSimulationParameters.h"
#include "ASMTAnimationParameters.h"
#include "Part.h"
#include "ASMTTime.h"
#include "ASMTItemIJ.h"
#include "SimulationStoppingError.h"
#include "ASMTKinematicIJ.h"
#include "ASMTRefPoint.h"
#include "ExternalSystem.h"
#include "SystemSolver.h"
#include "ASMTLimit.h"
#include "ASMTConstraintSet.h"

using namespace MbD;

MbD::ASMTAssembly::ASMTAssembly()
    : ASMTSpatialContainer()
{
    externalSystem = std::make_shared<ExternalSystem>();
    times = std::make_shared<FullRow<double>>();
}

std::shared_ptr<ASMTAssembly> MbD::ASMTAssembly::With()
{
    auto asmt = std::make_shared<ASMTAssembly>();
    asmt->initialize();
    return asmt;
}

void MbD::ASMTAssembly::initialize()
{
    ASMTSpatialContainer::initialize();
    times = std::make_shared<FullRow<double>>();
}

ASMTAssembly* MbD::ASMTAssembly::root()
{
    return this;
}

void MbD::ASMTAssembly::setNotes(const std::string& str)
{
    notes = str;
}

void MbD::ASMTAssembly::outputFor(AnalysisType)
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTAssembly::preMbDrun(std::shared_ptr<System> mbdSys)
{
    calcCharacteristicDimensions();
    deleteMbD();
    createMbD(mbdSys, mbdUnits);
    std::static_pointer_cast<Part>(mbdObject)->asFixed();
}

void MbD::ASMTAssembly::preMbDrunDragStep(std::shared_ptr<System> mbdSys, std::shared_ptr<std::vector<std::shared_ptr<Part>>> /*dragParts*/)
{
    for (auto& part : *parts) {
        part->preMbDrunDragStep(mbdSys, mbdUnits);
    }
}

void MbD::ASMTAssembly::postMbDrun()
{
    throw SimulationStoppingError("To be implemented.");
}

void MbD::ASMTAssembly::calcCharacteristicDimensions()
{
    auto unitTime = this->calcCharacteristicTime();
    auto unitMass = this->calcCharacteristicMass();
    auto unitLength = this->calcCharacteristicLength();
    auto unitAngle = 1.0;
    this->mbdUnits = std::make_shared<Units>(unitTime, unitMass, unitLength, unitAngle);
    this->mbdUnits = std::make_shared<Units>(1.0, 1.0, 1.0, 1.0);  // for debug
}

double MbD::ASMTAssembly::calcCharacteristicTime() const
{
    return std::abs(simulationParameters->hout);
}

double MbD::ASMTAssembly::calcCharacteristicMass() const
{
    auto n = parts->size();
    double sumOfSquares = 0.0;
    for (size_t i = 0; i < n; i++) {
        auto mass = parts->at(i)->principalMassMarker->mass;
        sumOfSquares += mass * mass;
    }
    auto unitMass = std::sqrt(sumOfSquares / n);
    if (unitMass <= 0) {
        unitMass = 1.0;
    }
    return unitMass;
}

double MbD::ASMTAssembly::calcCharacteristicLength() const
{
    auto markerMap = this->markerMap();
    auto lengths = std::make_shared<std::vector<double>>();
    auto connectorList = this->connectorList();
    for (auto& connector : *connectorList) {
        auto& mkrI = markerMap->at(connector->markerI);
        lengths->push_back(mkrI->rpmp()->length());
        auto& mkrJ = markerMap->at(connector->markerJ);
        lengths->push_back(mkrJ->rpmp()->length());
    }
    auto n = lengths->size();
    double sumOfSquares =
        std::accumulate(lengths->begin(), lengths->end(), 0.0, [](double sum, double l) {
            return sum + l * l;
        });
    auto unitLength = std::sqrt(sumOfSquares / std::max(n, size_t(1)));
    if (unitLength <= 0) {
        unitLength = 1.0;
    }
    return unitLength;
}

std::shared_ptr<std::vector<std::shared_ptr<ASMTItemIJ>>> MbD::ASMTAssembly::connectorList() const
{
    auto list = std::make_shared<std::vector<std::shared_ptr<ASMTItemIJ>>>();
    list->insert(list->end(), joints->begin(), joints->end());
    list->insert(list->end(), motions->begin(), motions->end());
    list->insert(list->end(), kinematicIJs->begin(), kinematicIJs->end());
    list->insert(list->end(), forcesTorques->begin(), forcesTorques->end());
    return list;
}

std::shared_ptr<std::map<std::string, std::shared_ptr<ASMTMarker>>>
MbD::ASMTAssembly::markerMap() const
{
    auto answer = std::make_shared<std::map<std::string, std::shared_ptr<ASMTMarker>>>();
    for (auto& refPoint : *refPoints) {
        for (auto& marker : *refPoint->markers) {
            answer->insert(std::make_pair(marker->fullName(""), marker));
        }
    }
    for (auto& part : *parts) {
        for (auto& refPoint : *part->refPoints) {
            for (auto& marker : *refPoint->markers) {
                answer->insert(std::make_pair(marker->fullName(""), marker));
            }
        }
    }
    return answer;
}

void MbD::ASMTAssembly::deleteMbD()
{
    ASMTSpatialContainer::deleteMbD();
    constantGravity->deleteMbD();
    asmtTime->deleteMbD();
    for (auto& part : *parts) {
        part->deleteMbD();
    }
    for (auto& joint : *joints) {
        joint->deleteMbD();
    }
    for (auto& motion : *motions) {
        motion->deleteMbD();
    }
    for (auto& limit : *limits) {
        limit->deleteMbD();
    }
    for (auto& forceTorque : *forcesTorques) {
        forceTorque->deleteMbD();
    }
}

void MbD::ASMTAssembly::createMbD(std::shared_ptr<System> mbdSys, std::shared_ptr<Units> mbdUnits)
{
    ASMTSpatialContainer::createMbD(mbdSys, mbdUnits);
    constantGravity->createMbD(mbdSys, mbdUnits);
    asmtTime->createMbD(mbdSys, mbdUnits);
    std::sort(parts->begin(),
              parts->end(),
              [](std::shared_ptr<ASMTPart> a, std::shared_ptr<ASMTPart> b) {
                  return a->name < b->name;
              });
    auto jointsMotions = std::make_shared<std::vector<std::shared_ptr<ASMTConstraintSet>>>();
    jointsMotions->insert(jointsMotions->end(), joints->begin(), joints->end());
    jointsMotions->insert(jointsMotions->end(), motions->begin(), motions->end());
    std::sort(jointsMotions->begin(),
              jointsMotions->end(),
              [](std::shared_ptr<ASMTConstraintSet> a, std::shared_ptr<ASMTConstraintSet> b) {
                  return a->name < b->name;
              });
    std::sort(limits->begin(),
              limits->end(),
              [](std::shared_ptr<ASMTLimit> a, std::shared_ptr<ASMTLimit> b) {
                  return a->name < b->name;
              });
    std::sort(forcesTorques->begin(),
              forcesTorques->end(),
              [](std::shared_ptr<ASMTForceTorque> a, std::shared_ptr<ASMTForceTorque> b) {
                  return a->name < b->name;
              });
    for (auto& part : *parts) {
        part->createMbD(mbdSys, mbdUnits);
    }
    for (auto& joint : *jointsMotions) {
        joint->createMbD(mbdSys, mbdUnits);
    }
    for (auto& limit : *limits) {
        limit->createMbD(mbdSys, mbdUnits);
    }
    for (auto& forceTorque : *forcesTorques) {
        forceTorque->createMbD(mbdSys, mbdUnits);
    }

    auto& mbdSysSolver = mbdSys->systemSolver;
    mbdSysSolver->errorTolPosKine = simulationParameters->errorTolPosKine;
    mbdSysSolver->errorTolAccKine = simulationParameters->errorTolAccKine;
    mbdSysSolver->iterMaxPosKine = simulationParameters->iterMaxPosKine;
    mbdSysSolver->iterMaxAccKine = simulationParameters->iterMaxAccKine;
    mbdSysSolver->tstart = simulationParameters->tstart / mbdUnits->time;
    mbdSysSolver->tend = simulationParameters->tend / mbdUnits->time;
    mbdSysSolver->hmin = simulationParameters->hmin / mbdUnits->time;
    mbdSysSolver->hmax = simulationParameters->hmax / mbdUnits->time;
    mbdSysSolver->hout = simulationParameters->hout / mbdUnits->time;
    mbdSysSolver->corAbsTol = simulationParameters->corAbsTol;
    mbdSysSolver->corRelTol = simulationParameters->corRelTol;
    mbdSysSolver->intAbsTol = simulationParameters->intAbsTol;
    mbdSysSolver->intRelTol = simulationParameters->intRelTol;
    mbdSysSolver->iterMaxDyn = simulationParameters->iterMaxDyn;
    mbdSysSolver->orderMax = simulationParameters->orderMax;
    mbdSysSolver->translationLimit = simulationParameters->translationLimit / mbdUnits->length;
    mbdSysSolver->rotationLimit = simulationParameters->rotationLimit;
    // animationParameters = nullptr;
}

size_t MbD::ASMTAssembly::numberOfFrames()
{
    return times->size();
}

void MbD::ASMTAssembly::solve()
{
    auto simulationParameters = CREATE<ASMTSimulationParameters>::With();
    simulationParameters->settstart(0.0);
    simulationParameters->settend(0.0);  // tstart == tend Initial Conditions only.
    simulationParameters->sethmin(1.0e-9);
    simulationParameters->sethmax(1.0);
    simulationParameters->sethout(0.04);
    simulationParameters->seterrorTol(1.0e-6);
    setSimulationParameters(simulationParameters);

    runKINEMATIC();
}

void MbD::ASMTAssembly::runPreDrag()
{
    mbdSystem = std::make_shared<System>();
    mbdSystem->externalSystem->asmtAssembly = this;
    mbdSystem->externalSystem->messages = solverMessages;
    mbdSystem->runPreDrag(mbdSystem);
}

void MbD::ASMTAssembly::runDragStep(
    std::shared_ptr<std::vector<std::shared_ptr<ASMTPart>>> dragASMTParts)
{
    auto dragMbDParts = std::make_shared<std::vector<std::shared_ptr<Part>>>();
    auto crO1 = std::make_shared<std::vector<FColDsptr>>();
    auto crO2 = std::make_shared<std::vector<FColDsptr>>();
    auto cqEO1 = std::make_shared<std::vector<std::shared_ptr<EulerParameters<double>>>>();
    auto cqEO2 = std::make_shared<std::vector<std::shared_ptr<EulerParameters<double>>>>();
    for (auto& dragASMTPart : *dragASMTParts) {
        auto dragMbDPart = std::static_pointer_cast<Part>(dragASMTPart->mbdObject);
        dragMbDParts->push_back(dragMbDPart);
        crO1->push_back(dragASMTPart->oldPos3D);
        crO2->push_back(dragASMTPart->position3D);
        cqEO1->push_back(dragASMTPart->oldRotMat->asEulerParameters());
        cqEO2->push_back(dragASMTPart->rotationMatrix->asEulerParameters());
    }
    bool success = false;
    for (int i = 0; i < 5; i++) {
        if (i > 0) {
            double factor = std::pow(2.0, -i);
            for (size_t j = 0; j < dragASMTParts->size(); j++) {
                auto& dragASMTPart = dragASMTParts->at(j);
                auto rO1 = crO1->at(j);
                auto rO2 = crO2->at(j);
                auto rOMid = rO1->times(1.0 - factor)->plusFullColumn(rO2->times(factor));
                dragASMTPart->setPosition3D(rOMid);
                auto qEO1 = cqEO1->at(j);
                auto qEO2 = cqEO2->at(j);
                std::shared_ptr<EulerParameters<double>> qEOmid;
                auto cosHalfTheta = qEO1->dot(qEO2);
                if (std::abs(cosHalfTheta) >= 1.0) {
                    qEOmid = qEO1->copy();
                }
                else {
                    auto halfTheta = std::acos(cosHalfTheta);
                    auto sinHalfTheta = std::sin(halfTheta);
                    double ratio1 = std::sin((1.0 - factor) * halfTheta) / sinHalfTheta;
                    double ratio2 = std::sin(factor * halfTheta) / sinHalfTheta;
                    qEOmid = qEO1->times(ratio1)->plusFullColumn(qEO2->times(ratio2));
                }
                qEOmid->calcABC();
                dragASMTPart->setRotationMatrix(qEOmid->aA);
            }
        }
        try {
            mbdSystem->runDragStep(mbdSystem, dragMbDParts);
            success = true;
            break;
        }
        catch (std::exception const& e) {
            // Do not use
            // runPreDrag();
            // Assembly breaks up too easily because of redundant constraint removal.
            noop();
        }
    }
    if (!success) restorePosRot();
}

void MbD::ASMTAssembly::runPostDrag()
{
    mbdSystem = std::make_shared<System>();
    mbdSystem->externalSystem->asmtAssembly = this;
    mbdSystem->externalSystem->messages = solverMessages;
    mbdSystem->runPreDrag(mbdSystem);
}

void MbD::ASMTAssembly::restorePosRot()
{
    for (auto& part : *parts) {
        part->restorePosRot();
    }
}

void MbD::ASMTAssembly::runKINEMATIC()
{
    mbdSystem = std::make_shared<System>();
    mbdSystem->externalSystem->asmtAssembly = this;
    mbdSystem->externalSystem->messages = solverMessages;
    try {
        mbdSystem->runKINEMATIC(mbdSystem);
    }
    catch (const SimulationStoppingError& ex) {
    }
}

void MbD::ASMTAssembly::initprincipalMassMarker()
{
    principalMassMarker = ASMTPrincipalMassMarker::With();
    principalMassMarker->mass = 0.0;
    principalMassMarker->density = 0.0;
    principalMassMarker->momentOfInertias = std::make_shared<DiagonalMatrix<double>>(3, 0);
    // principalMassMarker->position3D = std::make_shared<FullColumn<double>>(3, 0);
    // principalMassMarker->rotationMatrix = FullMatrix<double>>::identitysptr(3);
}

std::shared_ptr<ASMTSpatialContainer>
MbD::ASMTAssembly::spatialContainerAt(std::shared_ptr<ASMTAssembly> self,
                                      std::string& longname) const
{
    if ((self->fullName("")) == longname) {
        return self;
    }
    auto it = std::find_if(parts->begin(), parts->end(), [&](const std::shared_ptr<ASMTPart>& prt) {
        return prt->fullName("") == longname;
    });
    auto& part = *it;
    return part;
}

std::shared_ptr<ASMTPart> MbD::ASMTAssembly::partAt(const std::string& longname) const
{
    for (auto& part : *parts) {
        if (part->fullName("") == longname) {
            return part;
        }
    }
    return nullptr;
}

std::shared_ptr<ASMTMarker> MbD::ASMTAssembly::markerAt(const std::string& longname) const
{
    for (auto& refPoint : *refPoints) {
        for (auto& marker : *refPoint->markers) {
            if (marker->fullName("") == longname) {
                return marker;
            }
        }
    }
    for (auto& part : *parts) {
        for (auto& refPoint : *part->refPoints) {
            for (auto& marker : *refPoint->markers) {
                if (marker->fullName("") == longname) {
                    return marker;
                }
            }
        }
    }
    return nullptr;
}

std::shared_ptr<ASMTJoint> MbD::ASMTAssembly::jointAt(const std::string& longname) const
{
    auto it =
        std::find_if(joints->begin(), joints->end(), [&](const std::shared_ptr<ASMTJoint>& jt) {
            return jt->fullName("") == longname;
        });
    auto& joint = *it;
    return joint;
}

std::shared_ptr<ASMTMotion> MbD::ASMTAssembly::motionAt(const std::string& longname) const
{
    auto it =
        std::find_if(motions->begin(), motions->end(), [&](const std::shared_ptr<ASMTMotion>& mt) {
            return mt->fullName("") == longname;
        });
    auto& motion = *it;
    return motion;
}

std::shared_ptr<ASMTForceTorque> MbD::ASMTAssembly::forceTorqueAt(const std::string& longname) const
{
    auto it = std::find_if(forcesTorques->begin(),
                           forcesTorques->end(),
                           [&](const std::shared_ptr<ASMTForceTorque>& mt) {
                               return mt->fullName("") == longname;
                           });
    auto& forceTorque = *it;
    return forceTorque;
}

FColDsptr MbD::ASMTAssembly::vOcmO()
{
    return std::make_shared<FullColumn<double>>(3, 0.0);
}

FColDsptr MbD::ASMTAssembly::omeOpO()
{
    return std::make_shared<FullColumn<double>>(3, 0.0);
}

std::shared_ptr<ASMTTime> MbD::ASMTAssembly::geoTime() const
{
    return asmtTime;
}

void MbD::ASMTAssembly::updateFromMbD()
{
    ASMTSpatialContainer::updateFromMbD();
    auto time = asmtTime->getValue();
    times->push_back(time);
    for (auto& part : *parts) {
        part->updateFromMbD();
    }
    for (auto& joint : *joints) {
        joint->updateFromMbD();
    }
    for (auto& motion : *motions) {
        motion->updateFromMbD();
    }
    for (auto& forceTorque : *forcesTorques) {
        forceTorque->updateFromMbD();
    }
}

void MbD::ASMTAssembly::compareResults(AnalysisType type)
{
    ASMTSpatialContainer::compareResults(type);
    for (auto& part : *parts) {
        part->compareResults(type);
    }
    for (auto& joint : *joints) {
        joint->compareResults(type);
    }
    for (auto& motion : *motions) {
        motion->compareResults(type);
    }
    for (auto& forceTorque : *forcesTorques) {
        forceTorque->compareResults(type);
    }
}

void MbD::ASMTAssembly::outputResults(AnalysisType type)
{
    (void) type;
	//ASMTSpatialContainer::outputResults(type);
	//for (auto& part : *parts) part->outputResults(type);
	//for (auto& joint : *joints) joint->outputResults(type);
	//for (auto& motion : *motions) motion->outputResults(type);
	//for (auto& forceTorque : *forcesTorques) forceTorque->outputResults(type);
}

void MbD::ASMTAssembly::addPart(std::shared_ptr<ASMTPart> part)
{
    parts->push_back(part);
    part->owner = this;
}

void MbD::ASMTAssembly::addJoint(std::shared_ptr<ASMTJoint> joint)
{
    joints->push_back(joint);
    joint->owner = this;
}

void MbD::ASMTAssembly::addMotion(std::shared_ptr<ASMTMotion> motion)
{
    motions->push_back(motion);
    motion->owner = this;
    motion->initMarkers();
}

void MbD::ASMTAssembly::addLimit(std::shared_ptr<ASMTLimit> limit)
{
    limits->push_back(limit);
    limit->owner = this;
    limit->initMarkers();
}

void MbD::ASMTAssembly::setConstantGravity(std::shared_ptr<ASMTConstantGravity> gravity)
{
    constantGravity = gravity;
    gravity->owner = this;
}

void MbD::ASMTAssembly::setSimulationParameters(
    std::shared_ptr<ASMTSimulationParameters> parameters)
{
    simulationParameters = parameters;
    parameters->owner = this;
}

std::shared_ptr<ASMTPart> MbD::ASMTAssembly::partNamed(const std::string& partName) const
{
    auto it = std::find_if(parts->begin(), parts->end(), [&](const std::shared_ptr<ASMTPart>& prt) {
        return prt->fullName("") == partName;
    });
    auto& part = *it;
    return part;
}

std::shared_ptr<ASMTPart> MbD::ASMTAssembly::partPartialNamed(const std::string& partialName) const
{
    auto it = std::find_if(parts->begin(), parts->end(), [&](const std::shared_ptr<ASMTPart>& prt) {
        auto fullName = prt->fullName("");
        return fullName.find(partialName) != std::string::npos;
    });
    auto& part = *it;
    return part;
}

void MbD::ASMTAssembly::updateForFrame(size_t index)
{
    ASMTSpatialContainer::updateForFrame(index);
    for (auto& part : *parts) {
        part->updateForFrame(index);
    }
    //for (auto& joint : *joints) {
    //    joint->updateForFrame(index);
    //}
    //for (auto& motion : *motions) {
    //    motion->updateForFrame(index);
    //}
    //for (auto& forceTorque : *forcesTorques) {
    //    forceTorque->updateForFrame(index);
    //}
}
