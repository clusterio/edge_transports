"use strict";
const libLink = require("@clusterio/lib/link");
const libConfig = require("@clusterio/lib/config");


class InstanceConfigGroup extends libConfig.PluginConfigGroup { }
InstanceConfigGroup.groupName = "edge_transports";
InstanceConfigGroup.define({
	name: "internal",
	type: "object",
	initial_value: { edges: [] },
});
InstanceConfigGroup.finalize();

// let example_edge = {
//     "id": 1,
//     "origin": [10, -10],
//     "surface": 1,
//     "direction": 1,
//     "length": 20,
//     "target_instance": 324,
//     "target_id": 1,
// };

let instanceToInstance = ["instance-slave", "slave-master", "master-slave", "slave-instance"];

module.exports = {
	name: "edge_transports",
	title: "Edge Transports",
	description:
		"Lets transport belts and pipes pass over the edge "+
		"from one server to another",
	instanceEntrypoint: "instance",
	masterEntrypoint: "master",

	InstanceConfigGroup,

	messages: {
		edgeLinkUpdate: new libLink.Request({
			type: "edge_transports:edge_link_update",
			links: instanceToInstance,
			forwardTo: "instance",
			requestProperties: {
				"edge_id": { type: "integer" },
				"type": { type: "string" },
				"data": { type: "object" },
			},
		}),
	},
};
