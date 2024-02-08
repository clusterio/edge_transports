"use strict";
// Define messages for communication
module.exports = {
	ActivateEdgesAfterInternalUpdate: class ActivateEdgesAfterInternalUpdate {
		static plugin = "edge_transports";
		static type = "event";
		static src = "instance";
		static dst = "controller";
		static permission = "core.host.generate_token";
		static jsonSchema = {
			type: "object",
			properties: {
				instanceId: { type: "string" },
			},
		};
		constructor(json) {
			this.instanceId = json.instanceId;
		}
		static fromJSON(json) {
			return new this(json);
		}
	},
	EnsureEdgesDeactivated: class EnsureEdgesDeactivated {
		static plugin = "edge_transports";
		static type = "request";
		static src = "instance";
		static dst = "controller";
		static jsonSchema = {
			type: "object",
			properties: {
				instanceId: { type: "string" },
			},
		};
		constructor(instanceId) {
			this.instanceId = instanceId;
		}
		static fromJSON(json) {
			return new this(json.instanceId);
		}
	},
	SetActiveEdges: class SetActiveEdges {
		static plugin = "edge_transports";
		static type = "request";
		static src = "controller";
		static dst = "instance";
		static jsonSchema = {
			type: "object",
			properties: {
				activeEdges: {
					type: "array",
					items: { type: "integer" },
				},
			},
		};
		constructor(activeEdges) {
			this.activeEdges = activeEdges;
		}
		static fromJSON(json) {
			return new this(json.activeEdges);
		}
	},
	EdgeLinkUpdate: class EdgeLinkUpdate {
		static plugin = "edge_transports";
		static type = "event";
		static src = "instance";
		static dst = "instance";
		static jsonSchema = {
			type: "object",
			properties: {
				edgeId: { type: "integer" },
				type: { type: "string" },
				data: { type: "object" },
			},
		};
		constructor(edgeId, type, data) {
			this.edgeId = edgeId;
			this.type = type;
			this.data = data;
		}
		static fromJSON(json) {
			return new this(json.edgeId, json.type, json.data);
		}
	},
	EdgeTransfer: class EdgeTransfer {
		static plugin = "edge_transports";
		static type = "request";
		static src = "instance";
		static dst = "instance";
		static jsonSchema = {
			type: "object",
			properties: {
				edgeId: { type: "integer" },
				beltTransfers: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["offset"],
						properties: {
							offset: { type: "number" },
							itemStacks: {
								type: "array",
								items: { type: "object" },
							},
							setFlow: { type: "boolean" },
						},
					},
				},
			},
		};
		constructor(edgeId, beltTransfers) {
			this.edgeId = edgeId;
			this.beltTransfers = beltTransfers;
		}
		static fromJSON(json) {
			return new this(json.edgeId, json.beltTransfers);
		}
	},
};
