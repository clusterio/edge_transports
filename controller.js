"use strict";
const { BaseControllerPlugin } = require("@clusterio/controller");
const messages = require("./messages");


class ControllerPlugin extends BaseControllerPlugin {
	async init() {
		this.previousActiveEdges = new Set();
		this.activeEdges = new Set();
		this.instanceEdgeMap = new Map();
		this.instanceInternalUpdated = new Set();

		for (let [instanceId, instance] of this.controller.instances) {
			this.createInstanceEdges(instanceId, instance);
		}

		this.controller.handle(
			messages.ActivateEdgesAfterInternalUpdate,
			this.activateEdgesAfterInternalUpdateEventHandler.bind(this)
		);
		this.controller.handle(messages.EnsureEdgesDeactivated, this.ensureEdgesDeactivatedRequestHandler.bind(this));
	}

	createInstanceEdges(instanceId, instance) {
		let instanceEdges = new Map();
		this.instanceEdgeMap.set(instanceId, instanceEdges);

		let internal = instance.config.get("edge_transports.internal");
		for (let edgeConfig of internal["edges"]) {
			let edge = {
				hostId: instance.config.get("instance.assigned_host"),
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

	onHostConnectionEvent(connection, event) {
		if (event === "drop" || event === "close") {
			for (let edge of this.activeEdges) {
				let instance = this.controller.instances.get(edge.instanceId);
				if (edge.hostId === connection.id) {
					this.activeEdges.delete(edge);
					this.previousActiveEdges.delete(edge);
				} else if ((this.getTargetEdge(edge) || { hostId: null }).hostId === connection.id) {
					this.activeEdges.delete(edge);
				}
			}

			this.applyActiveEdges().catch(err => {
				this.logger.error(`Unexpected error:\n${err.stack}`);
			});

		} else if (event === "connect" || event === "resume") {
			for (let [instanceId, instance] of this.controller.instances) {
				if (instance.config.get("instance.assigned_host") === connection.id) {
					this.instanceInternalUpdated.delete(instanceId);
					this.activateEdges(instanceId);
				}
			}
			this.applyActiveEdges().catch(err => {
				this.logger.error(`Unexpected error:\n${err.stack}`);
			});
		}
	}

	async onPrepareHostDisconnect(connection) {
		for (let edge of this.activeEdges) {
			let instance = this.controller.instances.get(edge.instanceId);
			if (
				edge.hostId === connection.id
				|| (this.getTargetEdge(edge) || { hostId: null }).hostId === connection.id
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
			this.instanceInternalUpdated.delete(instanceId);
			this.activateEdges(instanceId);
		}

		await this.applyActiveEdges();
	}

	async onInstanceConfigFieldChanged(instance, field, currentValue, previousValue) {
		if (field === "edge_transports.internal") {
			const instanceId = instance.config.get("instance.id");
			this.instanceInternalUpdated.add(instanceId);
			for (let edge of this.activeEdges) {
				if (edge.instanceId === instanceId || edge.targetInstanceId === instanceId) {
					this.activeEdges.delete(edge);
				}
			}
			this.createInstanceEdges(instanceId, instance);

			await this.applyActiveEdges();

		} else if (field === "edge_transports.assigned_host") {
			const instanceEdges = this.instanceEdgeMap.get(instance.config.get("instance.id"));
			const newHostId = currentValue;
			for (let edge of instanceEdges.values()) {
				edge.hostId = newHostId;
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

			let targetInstance = this.controller.instances.get(targetEdge.instanceId);
			if (targetInstance.status !== "running") {
				continue;
			}

			let targetHostConnection = this.controller.wsServer.hostConnections.get(targetEdge.hostId);
			if (!targetHostConnection || !targetHostConnection.connector.connected) {
				continue;
			}

			this.activeEdges.add(edge);
			this.activeEdges.add(targetEdge);
		}
	}

	async activateEdgesAfterInternalUpdateEventHandler(message) {
		const { instanceId } = message;
		const instance = this.controller.instances.get(instanceId);
		if (!instance) {
			this.logger.warn(`Error - instance ${instanceId} does not exist`);
			return;
		}
		if (instance.status !== "running") {
			this.logger.warn(`Ignoring activate edges from ${instanceId} with status ${instance.status}`);
			return;
		}

		this.instanceInternalUpdated.delete(instanceId);
		this.activateEdges(instanceId);
		await this.applyActiveEdges();
	}

	async ensureEdgesDeactivatedRequestHandler(message) {
		const { instanceId } = message;
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
			let instance = this.controller.instances.get(instanceId);
			let hostId = instance.config.get("instance.assigned_host");
			let hostConnection = this.controller.wsServer.hostConnections.get(hostId);

			let activeInstanceEdges = [];
			for (let [instanceEdgeId, instanceEdge] of this.instanceEdgeMap.get(instanceId)) {
				if (this.activeEdges.has(instanceEdge)) {
					activeInstanceEdges.push(instanceEdgeId);
				}
			}
			if (instance.status === "running") {
				let task = hostConnection.sendTo({ instanceId }, new messages.SetActiveEdges(
					activeInstanceEdges,
				));
				tasks.push(task);
			}
		}

		this.previousActiveEdges = new Set(this.activeEdges);

		// TODO: Add timeout and wait for all settled
		await Promise.all(tasks);
	}
}

module.exports = {
	ControllerPlugin,
};
