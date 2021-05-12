"use strict";
const util = require("util");

const libPlugin = require("@clusterio/lib/plugin");
const libLuaTools = require("@clusterio/lib/lua_tools");
const RateLimiter = require("@clusterio/lib/RateLimiter");


function mergeBeltTransfers(pendingBeltTransfers, beltTransfers) {
	for (let beltTransfer of beltTransfers) {
		let pending = pendingBeltTransfers.get(beltTransfer.offset);
		if (!pending) {
			pending = {};
			pendingBeltTransfers.set(beltTransfer.offset, pending);
		}
		if (beltTransfer.item_stacks) {
			if (!pending.item_stacks) {
				pending.item_stacks = [];
			}
			pending.item_stacks.push(...beltTransfer.item_stacks);
		}
		if (Object.prototype.hasOwnProperty.call(beltTransfer, "set_flow")) {
			pending.set_flow = beltTransfer.set_flow;
		}
	}
}

class InstancePlugin extends libPlugin.BaseInstancePlugin {
	async init() {
		if (!this.instance.config.get("factorio.enable_save_patching")) {
			throw new Error("edge_transports plugin requires save patching");
		}

		this.edges = new Map();

		let internal = this.instance.config.get("edge_transports.internal");
		await this.updateInternal(internal, internal);

		this.instance.server.on("ipc-edge_transports:edge_link_update", data => {
			this.handleEdgeLinkUpdate(data).catch(err => this.logger.error(
				`Error handling edge_link_update:\n${err.stack}`
			));
		});

		this.instance.server.on("ipc-edge_transports:transfer", data => {
			this.edgeTransferFromGame(data).catch(err => this.logger.error(
				`Error handling transfer:\n${err.stack}`
			));
		});
	}

	async setActiveEdgesRequestHandler(message) {
		let json = libLuaTools.escapeString(JSON.stringify(message.data.active_edges));
		this.logger.info(`setActiveEdges ${json}`);
		await this.sendRcon(`/sc edge_transports.set_active_edges("${json}")`, true);
	}

	onMasterConnectionEvent(event) {
		if (event === "drop" || event === "close") {
			this.sendRcon('/sc edge_transports.set_active_edges("[]")').catch(
				err => this.logger(`Error deactivating edges:\n${err.stack}`)
			);
		}
	}

	async handleEdgeLinkUpdate(update) {
		let edge = this.edges.get(update.edge_id);
		if (!edge) {
			this.logger.warn(`Got update for unknown edge ${update.edge_id}`);
			return;
		}

		let result = await this.info.messages.edgeLinkUpdate.send(this.instance, {
			instance_id: edge.config.target_instance,
			type: update.type,
			edge_id: edge.config.target_edge,
			data: update.data,
		});
	}

	async edgeLinkUpdateEventHandler(message) {
		let { type, edge_id, data } = message.data;
		let json = libLuaTools.escapeString(JSON.stringify({ type, edge_id, data }));
		let result = await this.sendRcon(`/sc edge_transports.edge_link_update("${json}")`, true);
	}

	async updateInternal(internal, prev) {
		this.internal = internal;

		let newEdges = new Set();
		for (let edgeConfig of this.internal["edges"]) {
			newEdges.add(edgeConfig.id);
			let edge = this.edges.get(edgeConfig.id);
			if (edge) {
				edge.config = edgeConfig;
			} else {
				edge = {
					config: edgeConfig,
					pendingMessage: {
						beltTransfers: new Map(),
					},
					messageTransfer: new RateLimiter({
						maxRate: this.instance.config.get("edge_transports.transfer_message_rate"),
						action: () => this.edgeTransferSendMessage(edgeConfig.id).catch(err => this.logger.error(
							`Error sending transfer message:\n${err.stack}`
						)),
					}),
					pendingCommand: {
						beltTransfers: new Map(),
					},
					commandTransfer: new RateLimiter({
						maxRate: this.instance.config.get("edge_transports.transfer_command_rate"),
						action: () => this.edgeTransferSendCommand(edgeConfig.id).catch(err => this.logger.error(
							`Error sending transfer command:\n${err.stack}`
						)),
					}),
				};
				this.edges.set(edgeConfig.id, edge);
			}
		}

		for (let [id, edge] of this.edges) {
			if (!newEdges.has(id)) {
				edge.messageTransfer.cancel();
				edge.commandTransfer.cancel();
				this.edges.delete(id);
			}
		}

		if (!util.isDeepStrictEqual(this.internal["edges"], prev["edges"])) {
			let json = libLuaTools.escapeString(JSON.stringify(this.internal["edges"]));
			await this.sendRcon(`/sc edge_transports.set_edges("${json}")`, true);
			if (this.instance.status === "running" && this.slave.connector.connected) {
				this.info.messages.activateEdgesAfterInternalUpdate.send(
					this.instance, { instance_id: this.instance.id }
				);
			}
		}
	}

	async updateTicksPerEdge(value) {
		await this.sendRcon(`/sc global.edge_transports.ticks_per_edge = ${value}`);
	}

	async edgeTransferFromGame(data) {
		let edge = this.edges.get(data.edge_id);
		if (!edge) {
			let json = libLuaTools.escapeString(JSON.stringify(data));
			console.log("edge not found");
			return; // XXX LATER PROBLEM
		}

		mergeBeltTransfers(edge.pendingMessage.beltTransfers, data.belt_transfers || []);
		edge.messageTransfer.activate();
	}

	async edgeTransferSendMessage(edgeId) {
		let edge = this.edges.get(edgeId);
		if (!edge) {
			console.log("impossible edge not found!");
			return; // XXX LATER PROBLEM
		}

		let pendingBeltTransfers = edge.pendingMessage.beltTransfers;
		edge.pendingMessage.beltTransfers = new Map();

		let beltTransfers = [];
		for (let [offset, beltTransfer] of pendingBeltTransfers) {
			beltTransfers.push({
				offset,
				...beltTransfer,
			});
		}

		try {
			await this.info.messages.edgeTransfer.send(this.instance, {
				instance_id: edge.config.target_instance,
				edge_id: edge.config.target_edge,
				belt_transfers: beltTransfers,
			});

		// We assume the transfer did not happen if an error occured.
		} catch (err) {
			throw err;
			// TODO return items
		}
	}

	async edgeTransferRequestHandler(message) {
		let { edge_id, belt_transfers } = message.data;
		let edge = this.edges.get(edge_id);
		if (!edge) {
			console.log("impossible the edge was not found!");
			return; // XXX later problem
		}

		mergeBeltTransfers(edge.pendingCommand.beltTransfers, belt_transfers)
		edge.commandTransfer.activate();
	}

	async edgeTransferSendCommand(edgeId) {
		let edge = this.edges.get(edgeId);
		if (!edge) {
			console.log("how can this happen");
			return; // XXX later problem,
		}

		let pendingBeltTransfers = edge.pendingCommand.beltTransfers;
		edge.pendingCommand.beltTransfers = new Map();

		let beltTransfers = [];
		for (let [offset, beltTransfer] of pendingBeltTransfers) {
			beltTransfers.push({
				offset,
				...beltTransfer,
			});
		}

		let json = libLuaTools.escapeString(JSON.stringify({
			edge_id: edgeId,
			belt_transfers: beltTransfers,
		}));
		let result = await this.sendRcon(`/sc edge_transports.transfer("${json}")`, true);
	}

	async onStart() {
		await this.updateInternal(this.internal, {});
		await this.updateTicksPerEdge(this.instance.config.get("edge_transports.ticks_per_edge"));
	}

	async onInstanceConfigFieldChanged(group, field, prev) {
		if (group.name !== "edge_transports") {
			return;
		}

		let value = group.get(field);
		if (field === "internal") {
			await this.updateInternal(value, prev);

		} else if (field === "ticks_per_edge") {
			await this.updateTicksPerEdge(value);

		} else if (field === "transfer_message_rate") {
			for (let edge of this.edges.values()) {
				edge.messageTransfer.maxRate = value;
			}
		} else if (field === "transfer_command_rate") {
			for (let edge of this.edges.values()) {
				edge.commandTransfer.maxRate = value;
			}
		}
	}

	async onStop() {
		await this.info.messages.ensureEdgesDeactivated.send(this.instance, { instance_id: this.instance.id });
		await this.sendRcon('/sc edge_transports.set_active_edges("[]")')

		for (let edge of this.edges.values()) {
			edge.messageTransfer.cancel();
			edge.commandTransfer.cancel();
		}
	}

	onExit() {
		if (!this.edges) {
			return;
		}

		for (let edge of this.edges.values()) {
			edge.messageTransfer.cancel();
			edge.commandTransfer.cancel();
		}
	}
}

module.exports = {
	InstancePlugin,
};
