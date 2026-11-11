// lib/matching.js - Top Trading Cycles with Verifiable Random Draw Priority
const db = require("./database");

class HousingMatchingEngine {
  constructor(options = {}) {
    // Default to random_draw as certified standard
    this.priorityRule = options.priorityRule || "random_draw"; 
    this.allowCycles = options.allowCycles !== false;
    this.maxCycleLength = options.maxCycleLength || 100;
  }

  // Calculate priority score for an agent (higher score = higher priority)
  calculatePriorityScore(user, rule = this.priorityRule) {
    if (rule === "random_draw") {
      // Certified Electronic Random Priority Number
      // Smaller random draw number = Higher priority in lottery
      const randNum = user.random_priority_number || Math.floor(100000 + Math.random() * 900000);
      return 10000000 - randNum;
    } 
    else if (rule === "lottery_rank") {
      const rank = user.lottery_rank ? Number(user.lottery_rank) : 99999;
      return 100000 - rank;
    } 
    else if (rule === "seniority_age") {
      if (!user.birth_date) return 0;
      const bDate = new Date(user.birth_date).getTime();
      return 10000000000000 - bDate;
    } 
    else if (rule === "submission_time") {
      const regTime = user.registered_at ? new Date(user.registered_at).getTime() : Date.now();
      return 10000000000000 - regTime;
    } 
    else {
      return Math.random() * 1000000;
    }
  }

  run() {
    const rawUsers = db.getAllUsers();
    const apartments = db.getAllApartments();
    const aptMap = new Map();
    apartments.forEach(a => aptMap.set(a.id, a));

    const eligibleAgents = [];
    const nonSwappers = [];
    const completedSwaps = [];
    const aptToOwnerMap = new Map();

    for (const u of rawUsers) {
      const fullUser = db.getUserByNationalId(u.national_id);
      if (!fullUser || !fullUser.original_apartment_id) {
        continue;
      }

      if (fullUser.swap_status === 'AGREED_DIRECT') {
        let partnerAptId = fullUser.original_apartment_id;
        let partnerUser = null;
        if (fullUser.direct_partner_user_id) {
          partnerUser = db.getUserById(fullUser.direct_partner_user_id);
          if (partnerUser && partnerUser.original_apartment_id) {
            partnerAptId = partnerUser.original_apartment_id;
          }
        }

        const pairCode = fullUser.direct_partner_user_id
          ? `DIRECT-PAIR-${Math.min(fullUser.id, fullUser.direct_partner_user_id)}-${Math.max(fullUser.id, fullUser.direct_partner_user_id)}`
          : `DIRECT-PAIR-${fullUser.id}`;

        const origApt = aptMap.get(fullUser.original_apartment_id);
        const assignApt = aptMap.get(partnerAptId);

        completedSwaps.push({
          id: fullUser.id,
          userId: fullUser.id,
          name: fullUser.full_name,
          userName: fullUser.full_name,
          nationalId: fullUser.national_id,
          phone: fullUser.phone,
          workplace: fullUser.workplace || '',
          randomPriorityNumber: fullUser.random_priority_number,
          originalAptId: fullUser.original_apartment_id,
          origDistrict: origApt ? origApt.district : '',
          origNeighborhood: origApt ? origApt.neighborhood : '',
          origBuilding: origApt ? origApt.building : '',
          origUnit: origApt ? origApt.unit_number : '',
          origFloorLabel: origApt ? origApt.floor_label : '',
          origNatId: origApt ? origApt.national_property_id : '',
          origAptCode: origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '',
          assignedAptId: partnerAptId,
          assignDistrict: assignApt ? assignApt.district : '',
          assignNeighborhood: assignApt ? assignApt.neighborhood : '',
          assignBuilding: assignApt ? assignApt.building : '',
          assignUnit: assignApt ? assignApt.unit_number : '',
          assignFloorLabel: assignApt ? assignApt.floor_label : '',
          assignNatId: assignApt ? assignApt.national_property_id : '',
          assignedAptCode: assignApt ? `${assignApt.district}-${assignApt.neighborhood}-ع ${assignApt.building}-و ${assignApt.unit_number}` : '',
          rankAchieved: 1,
          swapType: "DIRECT_PAIR",
          cycleId: pairCode,
          reason: "تم التوافق الودي المباشر (One-to-One) المعتمد",
          cyclePartners: partnerUser ? [{
            id: partnerUser.id,
            name: partnerUser.full_name,
            nid: partnerUser.national_id,
            phone: partnerUser.phone,
            workplace: partnerUser.workplace || ''
          }] : []
        });
      } else if (fullUser.wants_swap === 0 || fullUser.swap_status === 'KEPT_ORIGINAL' || !fullUser.preferences || fullUser.preferences.length === 0) {
        const origApt = aptMap.get(fullUser.original_apartment_id);
        nonSwappers.push({
          userId: fullUser.id,
          userName: fullUser.full_name,
          nationalId: fullUser.national_id,
          phone: fullUser.phone,
          workplace: fullUser.workplace || '',
          randomPriorityNumber: fullUser.random_priority_number,
          originalAptId: fullUser.original_apartment_id,
          assignedAptId: fullUser.original_apartment_id,
          origNatId: origApt ? origApt.national_property_id : '',
          assignNatId: origApt ? origApt.national_property_id : '',
          origAptCode: origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '',
          assignedAptCode: origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '',
          rankAchieved: 0,
          swapType: "KEPT_ORIGINAL",
          reason: "الموظف اختار الاحتفاظ بشقته الأصلية وعدم التبديل",
          cyclePartners: []
        });
      } else {
        const agent = {
          id: fullUser.id,
          name: fullUser.full_name,
          nationalId: fullUser.national_id,
          phone: fullUser.phone,
          workplace: fullUser.workplace || '',
          lotteryRank: fullUser.lottery_rank,
          randomPriorityNumber: fullUser.random_priority_number,
          birthDate: fullUser.birth_date,
          originalAptId: fullUser.original_apartment_id,
          originalApt: aptMap.get(fullUser.original_apartment_id),
          priorityScore: this.calculatePriorityScore(fullUser),
          preferences: fullUser.preferences.map(p => ({
            aptId: p.id,
            rank: p.rank,
            aptCode: p.code,
            nationalPropertyId: p.national_property_id,
            district: p.district,
            neighborhood: p.neighborhood,
            building: p.building,
            unit: p.unit_number
          })),
          currentPrefIndex: 0,
          assignedAptId: null,
          rankAchieved: 0,
          cycleId: null,
          swapType: null,
          cyclePartners: []
        };
        eligibleAgents.push(agent);
        aptToOwnerMap.set(agent.originalAptId, agent);
      }
    }

    // Sort by priority score descending (highest priority agent gets preference on ties)
    eligibleAgents.sort((a, b) => b.priorityScore - a.priorityScore);

    let activeAgents = [...eligibleAgents];
    const executionCycles = [];
    let cycleCounter = 1;
    let round = 1;
    const maxRounds = 300;

    while (activeAgents.length > 0 && round <= maxRounds) {
      round++;
      const agentMap = new Map();
      activeAgents.forEach(a => agentMap.set(a.id, a));

      const pointers = new Map();

      for (const agent of activeAgents) {
        let matchedTarget = null;

        while (agent.currentPrefIndex < agent.preferences.length) {
          const desiredAptId = agent.preferences[agent.currentPrefIndex].aptId;
          const targetOwner = aptToOwnerMap.get(desiredAptId);

          if (targetOwner && agentMap.has(targetOwner.id)) {
            matchedTarget = targetOwner.id;
            break;
          } else {
            agent.currentPrefIndex++;
          }
        }

        if (matchedTarget !== null) {
          pointers.set(agent.id, matchedTarget);
        } else {
          pointers.set(agent.id, agent.id); // Points to self
        }
      }

      const foundCycles = this.findDirectedCycles(pointers, activeAgents.map(a => a.id));

      if (foundCycles.length === 0) {
        break;
      }

      let executedAnyInRound = false;
      const agentsToRemove = new Set();

      for (const cycle of foundCycles) {
        if (cycle.length === 1) {
          const aId = cycle[0];
          const agent = agentMap.get(aId);
          if (agent && !agentsToRemove.has(aId)) {
            agent.assignedAptId = agent.originalAptId;
            agent.rankAchieved = 0;
            agent.swapType = "KEPT_ORIGINAL";
            agent.reason = "لم تتوفر دورة تبادل متوافقة مع الرغبات المسجلة";
            agentsToRemove.add(aId);
            completedSwaps.push(agent);
          }
        } else {
          const hasOverlap = cycle.some(id => agentsToRemove.has(id));
          if (hasOverlap) continue;

          // If cycles restricted to bilateral only
          if (!this.allowCycles && cycle.length > 2) {
            cycle.forEach(id => {
              const ag = agentMap.get(id);
              if (ag) ag.currentPrefIndex++;
            });
            continue;
          }

          if (cycle.length > this.maxCycleLength) {
            cycle.forEach(id => {
              const ag = agentMap.get(id);
              if (ag) ag.currentPrefIndex++;
            });
            continue;
          }

          const cycleId = `CYCLE-${cycleCounter++}`;
          const cycleMembersDetails = cycle.map((id, idx) => {
            const ag = agentMap.get(id);
            const nextAg = agentMap.get(cycle[(idx + 1) % cycle.length]);
            const origApt = aptMap.get(ag.originalAptId);
            const targetApt = aptMap.get(nextAg.originalAptId);
            return { 
              id: ag.id, 
              name: ag.name, 
              nid: ag.nationalId, 
              phone: ag.phone, 
              workplace: ag.workplace || 'غير محدد',
              randomPriority: ag.randomPriorityNumber,
              origAptId: ag.originalAptId,
              origDistrict: origApt ? origApt.district : '',
              origNeighborhood: origApt ? origApt.neighborhood : '',
              origBuilding: origApt ? origApt.building : '',
              origUnit: origApt ? origApt.unit_number : '',
              origFloorLabel: origApt ? origApt.floor_label : '',
              origArea: origApt ? origApt.area : '',
              origNatId: origApt ? origApt.national_property_id : '',
              origAptCode: origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '',
              assignedAptId: nextAg.originalAptId,
              assignDistrict: targetApt ? targetApt.district : '',
              assignNeighborhood: targetApt ? targetApt.neighborhood : '',
              assignBuilding: targetApt ? targetApt.building : '',
              assignUnit: targetApt ? targetApt.unit_number : '',
              assignFloorLabel: targetApt ? targetApt.floor_label : '',
              assignArea: targetApt ? targetApt.area : '',
              assignNatId: targetApt ? targetApt.national_property_id : '',
              assignedAptCode: targetApt ? `${targetApt.district}-${targetApt.neighborhood}-ع ${targetApt.building}-و ${targetApt.unit_number}` : '',
              receivingFromName: nextAg.name,
              receivingFromPhone: nextAg.phone,
              receivingFromWorkplace: nextAg.workplace || ''
            };
          });

          for (let i = 0; i < cycle.length; i++) {
            const currentAgentId = cycle[i];
            const nextAgentId = cycle[(i + 1) % cycle.length];
            const prevAgentId = cycle[(i - 1 + cycle.length) % cycle.length];

            const currentAgent = agentMap.get(currentAgentId);
            const targetAgent = agentMap.get(nextAgentId);
            const prevAgent = agentMap.get(prevAgentId);

            const origApt = aptMap.get(currentAgent.originalAptId);
            currentAgent.assignedAptId = targetAgent.originalAptId;
            currentAgent.assignDistrict = targetApt ? targetApt.district : '';
            currentAgent.assignNeighborhood = targetApt ? targetApt.neighborhood : '';
            currentAgent.assignBuilding = targetApt ? targetApt.building : '';
            currentAgent.assignUnit = targetApt ? targetApt.unit_number : '';
            currentAgent.assignFloorLabel = targetApt ? targetApt.floor_label : '';
            currentAgent.assignArea = targetApt ? targetApt.area : '';
            currentAgent.assignNatId = targetApt ? targetApt.national_property_id : '';
            currentAgent.assignedAptCode = targetApt ? `${targetApt.district}-${targetApt.neighborhood}-ع ${targetApt.building}-و ${targetApt.unit_number}` : '';
            currentAgent.origNatId = origApt ? origApt.national_property_id : '';
            currentAgent.origAptCode = origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '';
            currentAgent.rankAchieved = currentAgent.preferences[currentAgent.currentPrefIndex].rank;
            currentAgent.swapType = cycle.length === 2 ? "DIRECT_PAIR" : (cycle.length === 3 ? "CYCLE_3" : "CYCLE_N");
            currentAgent.cycleId = cycleId;
            currentAgent.cyclePartners = cycleMembersDetails.filter(p => p.id !== currentAgent.id);
            currentAgent.allCycleMembers = cycleMembersDetails;
            currentAgent.receivingFrom = {
              id: targetAgent.id,
              name: targetAgent.name,
              phone: targetAgent.phone,
              workplace: targetAgent.workplace || 'غير محدد',
              nid: targetAgent.nationalId
            };
            currentAgent.givingTo = {
              id: prevAgent.id,
              name: prevAgent.name,
              phone: prevAgent.phone,
              workplace: prevAgent.workplace || 'غير محدد',
              nid: prevAgent.nationalId
            };

            agentsToRemove.add(currentAgentId);
            completedSwaps.push(currentAgent);
            executedAnyInRound = true;
          }

          executionCycles.push({
            cycleId,
            length: cycle.length,
            type: cycle.length === 2 ? "تبادل ثنائي مباشر" : `دورة تبادل (${cycle.length} أطراف)`,
            members: cycleMembersDetails
          });
        }
      }

      if (!executedAnyInRound && agentsToRemove.size === 0) {
        break;
      }

      activeAgents = activeAgents.filter(a => !agentsToRemove.has(a.id));
    }

    for (const remaining of activeAgents) {
      const origApt = aptMap.get(remaining.originalAptId);
      remaining.assignedAptId = remaining.originalAptId;
      remaining.origNatId = origApt ? origApt.national_property_id : '';
      remaining.assignNatId = origApt ? origApt.national_property_id : '';
      remaining.origAptCode = origApt ? `${origApt.district}-${origApt.neighborhood}-ع ${origApt.building}-و ${origApt.unit_number}` : '';
      remaining.assignedAptCode = remaining.origAptCode;
      remaining.rankAchieved = 0;
      remaining.swapType = "KEPT_ORIGINAL";
      remaining.reason = "انتهت خيارات الرغبات واحتفظ بالوحدة الأصلية";
      completedSwaps.push(remaining);
    }

    // Also include confirmed direct pairs into executionCycles
    const directCyclesMap = new Map();
    completedSwaps.filter(s => s.swapType === 'DIRECT_PAIR' && s.cycleId && s.cycleId.startsWith('DIRECT-PAIR-')).forEach(s => {
      if (!directCyclesMap.has(s.cycleId)) directCyclesMap.set(s.cycleId, []);
      directCyclesMap.get(s.cycleId).push(s);
    });

    directCyclesMap.forEach((members, cycleId) => {
      executionCycles.unshift({
        cycleId,
        length: members.length,
        type: "تبادل ثنائي مباشر معتمد",
        members: members.map(m => ({
          id: m.id,
          name: m.name || m.userName,
          nid: m.nationalId,
          phone: m.phone,
          workplace: m.workplace,
          origDistrict: m.origDistrict,
          origNeighborhood: m.origNeighborhood,
          origBuilding: m.origBuilding,
          origUnit: m.origUnit,
          origFloorLabel: m.origFloorLabel,
          origNatId: m.origNatId,
          origAptCode: m.origAptCode,
          assignDistrict: m.assignDistrict,
          assignNeighborhood: m.assignNeighborhood,
          assignBuilding: m.assignBuilding,
          assignUnit: m.assignUnit,
          assignFloorLabel: m.assignFloorLabel,
          assignNatId: m.assignNatId,
          assignedAptCode: m.assignedAptCode
        }))
      });
    });

    const allResults = [...completedSwaps, ...nonSwappers];

    const totalSwapped = completedSwaps.filter(s => s.swapType !== "KEPT_ORIGINAL").length;
    const rank1Count = completedSwaps.filter(s => s.rankAchieved === 1).length;
    const rank2Count = completedSwaps.filter(s => s.rankAchieved === 2).length;
    const rank3Count = completedSwaps.filter(s => s.rankAchieved === 3).length;
    const rank4PlusCount = completedSwaps.filter(s => s.rankAchieved >= 4).length;
    const keptCount = allResults.filter(s => s.swapType === "KEPT_ORIGINAL").length;

    return {
      success: true,
      timestamp: new Date().toISOString(),
      priorityRule: this.priorityRule,
      totalParticipants: allResults.length,
      totalEligible: eligibleAgents.length,
      totalSwapped,
      keptOriginal: keptCount,
      satisfaction: {
        rank1Count,
        rank1Percent: totalSwapped ? Math.round((rank1Count / totalSwapped) * 100) : 0,
        rank2Count,
        rank2Percent: totalSwapped ? Math.round((rank2Count / totalSwapped) * 100) : 0,
        rank3Count,
        rank3Percent: totalSwapped ? Math.round((rank3Count / totalSwapped) * 100) : 0,
        rank4PlusCount,
        rank4PlusPercent: totalSwapped ? Math.round((rank4PlusCount / totalSwapped) * 100) : 0
      },
      cycles: executionCycles,
      results: allResults
    };
  }

  findDirectedCycles(pointers, nodeIds) {
    const visited = new Set();
    const cycles = [];

    for (const startNode of nodeIds) {
      if (visited.has(startNode)) continue;

      const path = [];
      const inPath = new Set();
      let curr = startNode;

      while (curr !== undefined && !visited.has(curr)) {
        visited.add(curr);
        path.push(curr);
        inPath.add(curr);

        const next = pointers.get(curr);
        if (next === undefined) break;

        if (inPath.has(next)) {
          const cycleStartIdx = path.indexOf(next);
          const cycle = path.slice(cycleStartIdx);
          cycles.push(cycle);
          break;
        }

        curr = next;
      }
    }

    return cycles;
  }

  saveToDatabase(matchingResult) {
    const { priorityRule, totalSwapped, totalParticipants, results } = matchingResult;

    const runRes = db.db.prepare(`
      INSERT INTO swap_runs (run_timestamp, priority_rule, total_swapped, total_participants, is_published)
      VALUES (?, ?, ?, ?, 0)
    `).run(new Date().toISOString(), priorityRule, totalSwapped, totalParticipants);

    const runId = Number(runRes.lastInsertRowid);

    const insertRes = db.db.prepare(`
      INSERT INTO swap_results (run_id, user_id, original_apartment_id, orig_national_property_id, assigned_apartment_id, assign_national_property_id, rank_achieved, random_priority_number, swap_type, cycle_id)
      VALUES (?, ?, ?, (SELECT national_property_id FROM apartments WHERE id = ?), ?, (SELECT national_property_id FROM apartments WHERE id = ?), ?, ?, ?, ?)
    `);

    for (const r of results) {
      insertRes.run(
        runId,
        r.id || r.userId,
        r.originalAptId,
        r.originalAptId,
        r.assignedAptId,
        r.assignedAptId,
        r.rankAchieved || 0,
        r.randomPriorityNumber || null,
        r.swapType || "KEPT_ORIGINAL",
        r.cycleId || null
      );
    }

    return runId;
  }
}

module.exports = HousingMatchingEngine;
