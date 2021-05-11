"use strict";
const libPlugin = require("@clusterio/lib/plugin");


class MasterPlugin extends libPlugin.BaseMasterPlugin {
	async init() {
		this.previousActiveEdges = new Set();
		this.activeEdges = new Set();
		this.instanceEdgeMap = new Map();
		this.instanceInternalUpdated = new Set();

		for (let [instanceId, instance] of this.master.instances) {
			this.createInstanceEdges(instanceId, instance);
		}
	}

	createInstanceEdges(instanceId, instance) {
		let instanceEdges = new Map();
		this.instanceEdgeMap.set(instanceId, instanceEdges);

		let internal = instance.config.get("edge_transports.internal");
		for (let edgeConfig of internal["edges"]) {
			let edge = {
				slaveId: instance.config.get("instance.assigned_slave"),
				instanceId,
				edgeId: edgeConfig.id,
				targetInstanceId: edgeConfig.target_instance,
				targetEdgeId: edgeConfig.target_edge,
			};
			instanceEdges.set(edgeConfig.id, edge);
		}
	}

	getTargetEdge(edge) {
		let targetInstanceEdges = this.instanceEdgeMap.get(edge.targetInstanceId);
		if (!targetInstanceEdges) {
			return null;
		}

		let targetEdge = targetInstanceEdges.get(edge.targetEdgeId);
		if (!targetEdge) {
			return null;
		}

		return targetEdge;
	}

	onSlaveConnectionEvent(connection, event) {
		if (event === "drop" || event === "close") {
			for (let edge of this.activeEdges) {
				let instance = this.master.instances.get(edge.instanceId);
				if (edge.slaveId === connection.id) {
					this.activeEdges.delete(edge);
					this.previousActiveEdges.delete(edge);
				} else if ((this.getTargetEdge(edge) || { slaveId: null }).slaveId === connection.id) {
					this.activeEdges.delete(edge);
				}
			}

			this.applyActiveEdges().catch(err => {
				this.logger(`Unexpected error:\n${err.stack}`);
			});

		} else if (event === "connect" || event === "resume") {
			for (let [instanceId, instance] of this.master.instances) {
				if (instance.config.get("instance.assigned_slave") === connection.id) {
					this.instanceInternalUpdated.delete(instanceId);
					this.activateEdges(instanceId);
				}
			}
			this.applyActiveEdges().catch(err => {
				this.logger(`Unexpected error:\n${err.stack}`);
			});
		}
	}

	async onPrepareSlaveDisconnect(connection) {
		for (let edge of this.activeEdges) {
			let instance = this.master.instances.get(edge.instanceId);
			if (
				edge.slaveId === connection.id
				|| (this.getTargetEdge(edge) || { slaveId: null }).slaveId === connection.id
			) {
				this.activeEdges.delete(edge);
			}
		}

		await this.applyActiveEdges();
	}

	async onInstanceStatusChanged(instance, prev) {
		let instanceId = instance.config.get("instance.id");
		if (prev === null) {
			this.createInstanceEdges(instanceId, instance);
		}

		if (instance.status !== "running") {
			for (let edge of this.activeEdges) {
				if (edge.instanceId === instanceId || edge.targetInstanceId === instanceId) {
					this.activeEdges.delete(edge);
				}
			}

			if (instance.status === "deleted") {
				this.instanceEdgeMap.delete(instanceId);
			}
		} else {
			this.activateEdges(instanceId);
		}

		await this.applyActiveEdges();
	}

	async onInstanceConfigFieldChanged(instance, group, field, prev) {
		if (group.name === "edge_transports" && field === "internal") {
			let instanceId = instance.config.get("instance.id");
			this.instanceInternalUpdated.add(instanceId);
			for (let edge of this.activeEdges) {
				if (edge.instanceId === instanceId || edge.targetInstanceId === instanceId) {
					this.activeEdges.delete(edge);
				}
			}
			this.createInstanceEdges(instanceId, instance);

			await this.applyActiveEdges();

		} else if (group.name === "instance" && field === "assigned_slave") {
			let instanceEdges = this.instanceEdgeMap.get(instance.config.get("instance.id"));
			let newSlaveId = group.get(field);
			for (let edge of instanceEdges.values()) {
				edge.slaveId = newSlaveId;
				this.activeEdges.delete(edge);
				let targetEdge = this.getTargetEdge(edge);
				if (targetEdge) {
					this.activeEdges.delete(targetEdge);
				}
			}

			await this.applyActiveEdges();
		}
	}

	activateEdges(instanceId) {
		if (this.instanceInternalUpdated.has(instanceId)) {
			return;
		}

		for (let edge of this.instanceEdgeMap.get(instanceId).values()) {
			let targetEdge = this.getTargetEdge(edge);
			if (!targetEdge) {
				continue;
			}

			if (this.instanceInternalUpdated.has(targetEdge.instanceId)) {
				continue;
			}

			let targetInstance = this.master.instances.get(targetEdge.instanceId);
			if (targetInstance.status !== "running") {
				continue;
			}

			let targetSlaveConnection = this.master.wsServer.slaveConnections.get(targetEdge.slaveId);
			if (!targetSlaveConnection || !targetSlaveConnection.connector.connected) {
				continue;
			}

			this.activeEdges.add(edge);
			this.activeEdges.add(targetEdge);
		}

	}

	async activateEdgesAfterInternalUpdateEventHandler(message) {
		let instanceId = message.data.instance_id;
		let instance = this.master.instances.get(instanceId);

		if (instance.status !== "running") {
			this.logger.warn(`Ignoring activate edges from ${instanceId} with status ${instance.status}`);
			return;
		}

		this.instanceInternalUpdated.delete(instanceId);
		this.activateEdges(instanceId);
		await this.applyActiveEdges();
	}

	async ensureEdgesDeactivatedRequestHandler(message) {
		let instanceId = message.data.instance_id;
		for (let edge of this.activeEdges) {
			if (edge.instanceId === instanceId || edge.tragetInstanceId === instanceId) {
				this.logger.warn(
					`Instance ${instanceId} wants edges deactivated but ${edge.instanceId}:${edge.edgeId} is active`
				);
			}
		}

		// TODO: wait for active applyActiveEdges tasks
	}

	async applyActiveEdges() {
		let changedEdges = new Set();
		for (let edge of this.activeEdges) {
			if (!this.previousActiveEdges.has(edge)) {
				changedEdges.add(edge);
			}
		}
		for (let edge of this.previousActiveEdges) {
			if (!this.activeEdges.has(edge)) {
				changedEdges.add(edge);
			}
		}

		let changedInstances = new Set();
		for (let edge of changedEdges) {
			changedInstances.add(edge.instanceId);
		}

		let tasks = [];
		for (let instanceId of changedInstances) {
			let instance = this.master.instances.get(instanceId);
			let slaveId = instance.config.get("instance.assigned_slave");
			let slaveConnection = this.master.wsServer.slaveConnections.get(slaveId);

			let activeInstanceEdges = [];
			for (let [instanceEdgeId, instanceEdge] of this.instanceEdgeMap.get(instanceId)) {
				if (this.activeEdges.has(instanceEdge)) {
					activeInstanceEdges.push(instanceEdgeId);
				}
			}

			let task = this.info.messages.setActiveEdges.send(slaveConnection, {
				instance_id: instanceId,
				active_edges: activeInstanceEdges,
			});
			tasks.push(task);
		}

		this.previousActiveEdges = new Set(this.activeEdges);

		// TODO: Add timeout and wait for all settled
		await Promise.all(tasks);
	}
}

module.exports = {
	MasterPlugin,
};
