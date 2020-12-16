local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/clusterio/serialize")

local itertools = require("itertools")


local function vec2_sadd(a, s)
	return {a[1] + s, a[2] + s}
end

local function vec2_add(a, b)
	return {a[1] + b[1], a[2] + b[2]}
end

local function vec2_sub(a, b)
	return {a[1] - b[1], a[2] - b[2]}
end

local function vec2_smul(a, s)
	return {a[1] * s, a[2] * s}
end

local function vec2_mul(a, b)
	return {a[1] * b[1], a[2] * b[2]}
end

-- Rotate vector by entity direction, facing east means a clock wise rotation of 90 degrees.
local function vec2_rot(a, dir)
	if dir == 0 then return a end
	if dir == 2 then return {-a[2], a[1]} end
	if dir == 4 then return {-a[1], -a[2]} end
	if dir == 6 then return {a[2], -a[1]} end
	error("Invalid direction " .. serpent.line(dir))
end

local function dir_to_vec(dir)
	if dir == 0 then return {1, 0} end
	if dir == 2 then return {0, 1} end
	if dir == 4 then return {-1, 0} end
	if dir == 6 then return {0, -1} end
	error("Invalid direction " .. serpent.line(dir))
end

local function debug_draw()
	local debug_shapes = global.edge_transports.debug_shapes
	for index, id in ipairs(debug_shapes) do
		rendering.destroy(id)
		debug_shapes[index] = nil
	end

	if not global.edge_transports.debug_draw then
		return
	end

	for id, edge in pairs(global.edge_transports.edges) do
		debug_shapes[#debug_shapes + 1] = rendering.draw_circle {
			color = { r = 1, g = 0.2, b = 0.2 },
			radius = 0.25,
			width = 4,
			filled = false,
			target = edge.origin,
			surface = edge.surface,
		}

		debug_shapes[#debug_shapes + 1] = rendering.draw_text {
			color ={ r = 1, g = 1, b = 1 },
			text = id,
			target = vec2_add(edge.origin, {0.4, -0.8}),
			surface = edge.surface,
		}

		local dir = dir_to_vec(edge.direction)
		debug_shapes[#debug_shapes + 1] = rendering.draw_line {
			color = { r = 1, g = 0.2, b = 0.2 },
			width = 4,
			from = vec2_add(edge.origin, vec2_smul(dir, 0.25)),
			to = vec2_add(edge.origin, vec2_smul(dir, edge.length - 0.5)),
			surface = edge.surface,
		}
	end
end

local function world_to_edge_pos(pos, edge)
	return vec2_rot(vec2_sub(pos, edge.origin), -edge.direction % 8)
end

local function edge_pos_to_world(edge_pos, edge)
	return vec2_add(vec2_rot(edge_pos, edge.direction), edge.origin)
end

local function is_in_1x1_placement_area(edge_pos, edge)
	if edge_pos[2] <= 0 or edge_pos[2] >= 1 then return false end
	if edge_pos[1] <= 0 or edge_pos[1] >= edge.length then return false end

	return true
end

local function edge_pos_to_offset(edge_pos, edge)
	local offset = edge_pos[1]
	if edge.direction >= 4 then
		offset = edge.length - offset
	end
	return offset
end

local function offset_to_edge_x(offset, edge)
	local edge_x = offset
	if edge.direction >= 4 then
		edge_x = edge.length - edge_x
	end
	return edge_x
end

-- Check if a belt at world pos and direction is going to or from the given edge
-- returns edge offset if it does, otherwise nil
local function belt_check(pos, direction, edge)
	-- Check if the axis the belt in is pendicular to the edge
	if edge.direction % 4 ~= direction % 4 then
		return nil
	end

	local edge_pos = world_to_edge_pos(pos, edge)
	if not is_in_1x1_placement_area(edge_pos, edge) then
		return nil
	end

	return edge_pos_to_offset(edge_pos, edge)
end

local function spawn_belt_box(offset, edge, is_input, surface)
	local edge_x = offset_to_edge_x(offset, edge)

	local loader_pos = edge_pos_to_world({edge_x, -1}, edge)
	local loader
	if surface.entity_prototype_collides("loader", loader_pos, false, edge.direction) then
		-- Is the loader already there?
		loader = surface.find_entity("loader", loader_pos)
		if not loader then
			return false
		end
	end

	local chest_pos = edge_pos_to_world({edge_x, -2.5}, edge)
	local chest
	if surface.entity_prototype_collides("steel-chest", chest_pos, false) then
		-- Is the chest already there?
		chest = surface.find_entity("steel-chest", chest_pos)
		if not chest then
			return false
		end
	end

	if not loader then
		loader = surface.create_entity {
			name = "loader",
			position = loader_pos,
			direction = edge.direction,
		}
	end

	loader.loader_type = is_input and "input" or "output"

	if not chest then
		chest = surface.create_entity {
			name = "steel-chest",
			position = chest_pos,
		}
	end

	if not edge.linked_belts then
		edge.linked_belts = {}
	end

	if edge.linked_belts[offset] then
		edge.linked_belts[offset].chest = chest
		edge.linked_belts[offset].is_input = is_input
		edge.linked_belts[offset].flag_for_removal = false
	else
		edge.linked_belts[offset] = {
			chest = chest,
			is_input = is_input,
		}
	end

	return true
end

local function remove_belt_box(offset, edge, surface)
	local edge_x = offset_to_edge_x(offset, edge)
	if edge.linked_belts and edge.linked_belts[offset] then
		local link = edge.linked_belts[offset]

		if link.chest and link.chest.valid then
			local inventory = link.chest.get_inventory(defines.inventory.chest)
			if inventory and not inventory.is_empty() then
				link.flag_for_removal = true
				return
			end

			link.chest.destroy()
		end

		edge.linked_belts[offset] = nil

	else
		local chest_pos = edge_pos_to_world({edge_x, -2.5}, edge)
		local chest = surface.find_entity("steel-chest", chest_pos)

		if chest then
			local inventory = chest.get_inventory(defines.inventory.chest)
			if inventory and inventory.is_empty() then
				chest.destroy()
			end
		end
	end

	local loader_pos = edge_pos_to_world({edge_x, -1}, edge)
	local loader = surface.find_entity("loader", loader_pos)
	if loader then
		loader.destroy()
	end
end

local function create_belt_link(id, edge, offset, entity)
	local is_input = entity.direction == edge.direction
	spawn_belt_box(offset, edge, is_input, entity.surface)
	clusterio_api.send_json("edge_transports:edge_link_update", {
		type = "create_belt_link",
		edge_id = id,
		data = {
			offset = offset,
			is_input = not is_input,
		},
	})
end

local function on_built(entity)
	if entity.type == "transport-belt" then
		local pos = {entity.position.x, entity.position.y}
		for id, edge in pairs(global.edge_transports.edges) do
			if game.surfaces[edge.surface] == entity.surface then
				local offset = belt_check(pos, entity.direction, edge)
				if offset then
					create_belt_link(id, edge, offset, entity)
					break
				end
			end
		end
	end
end

local function remove_belt_link(id, edge, offset, entity)
	remove_belt_box(offset, edge, entity.surface)
	clusterio_api.send_json("edge_transports:edge_link_update", {
		type = "remove_belt_link",
		edge_id = id,
		data = {
			offset = offset,
		}
	})
end

local function on_removed(entity)
	if entity.type == "transport-belt" then
		local pos = {entity.position.x, entity.position.y}
		for id, edge in pairs(global.edge_transports.edges) do
			if game.surfaces[edge.surface] == entity.surface then
				local offset = belt_check(pos, entity.direction, edge)
				if offset then
					remove_belt_link(id, edge, offset, entity)
					break
				end
			end
		end
	end
end

local function poll_belt_link(offset, link)
	if not link.is_input or not link.chest or not link.chest.valid then
		return
	end

	local inventory = link.chest.get_inventory(defines.inventory.chest)
	local item_stacks = {}
	for index = 1, #inventory do
		local slot = inventory[index]
		if slot.valid_for_read then
			local stack = {}
			serialize.serialize_item_stack(slot, stack)
			item_stacks[#item_stacks + 1] = stack
			slot.clear()
		elseif inventory.is_empty() then
			break
		end
	end

	if #item_stacks > 0 then
		return {
			offset = offset,
			item_stacks = item_stacks
		}
	end
end

local function push_belt_link(link, item_stacks)
	if not link.chest or not link.chest.valid then
		log("FATAL: recevied items but target chest does not exist at off " .. offset)
		return
	end

	local inventory = link.chest.get_inventory(defines.inventory.chest)
	for index=1, #inventory do
		local slot = inventory[index]
		if not slot.valid_for_read then
			serialize.deserialize_item_stack(slot, item_stacks[#item_stacks])
			item_stacks[#item_stacks] = nil
			if #item_stacks == 0 then
				break
			end
		end
	end

	if #item_stacks ~= 0 then
		log("FATAL: item stacks left over!")
	end
end

local function poll_links(id, edge, ticks_left)
	if not edge.linked_belts then
		return
	end

	if not edge.linked_belts_state then
		edge.linked_belts_state = {}
	end

	local belt_transfers = {}
	for offset, link in itertools.partial_pairs(
		edge.linked_belts, edge.linked_belts_state, ticks_left
	) do
		local update = poll_belt_link(offset, link)
		if update then
			belt_transfers[#belt_transfers + 1] = update
		end
	end

	if #belt_transfers > 0 then
		clusterio_api.send_json("edge_transports:transfer", {
			edge_id = id,
			belt_transfers = belt_transfers,
		})
	end
end

-- Private API to plugin
edge_transports = {}
function edge_transports.set_edges(json)
	local new_edges = game.json_to_table(json)
	local new_edge_ids = {}
	local edges = global.edge_transports.edges
	for _, edge in ipairs(new_edges) do
		new_edge_ids[edge.id] = true
		if not edges[edge.id] then
			edges[edge.id] = {
				origin = edge.origin,
				surface = edge.surface,
				direction = edge.direction,
				length = edge.length,
			}

		else
			if
				edges[edge.id].origin[1] ~= edge.origin[1]
				or edges[edge.id].origin[2] ~= edge.origin[2]
				or edges[edge.id].surface ~= edge.surface
				or edges[edge.id].direction ~= edge.direction
				or edges[edge.id].length ~= edge.length
			then
				-- TODO destroy any existing edge logistics
				edges[edge.id].origin = edge.origin
				edges[edge.id].surface = edge.surface
				edges[edge.id].direction = edge.direction
				edges[edge.id].length = edge.length
			end
		end
	end

	for id, edge in pairs(edges) do
		if not new_edge_ids[id] then
			edges[id] = nil
		end
	end

	if global.edge_transports.debug_draw then
		debug_draw()
	end
end

function edge_transports.edge_link_update(json)
	local update = game.json_to_table(json)

	local data = update.data
	local edge = global.edge_transports.edges[update.edge_id]
	if not edge then
		log("Got update for unknown edge " .. serpent.line(update))
		return
	end
	local surface = game.surfaces[edge.surface]
	if not surface then
		log("Invalid surface for edge id " .. update.edge_id)
	end


	if update.type == "create_belt_link" then
		spawn_belt_box(data.offset, edge, data.is_input, surface)

	elseif update.type == "remove_belt_link" then
		remove_belt_box(data.offset, edge, surface)

	elseif update.type == "belt_input" then
		do_output(data.offset, edge, data.item_stacks)

	else
		log("Unknown link update: " .. serpent.line(update.type))
	end
end

function edge_transports.transfer(json)
	local data = game.json_to_table(json)
	local edge = global.edge_transports.edges[data.edge_id]
	if not edge then
		rcon.print("invalid edge")
		return
	end
	if data.belt_transfers then
		for _, belt_transfer in ipairs(data.belt_transfers) do
			local link = (edge.linked_belts or {})[belt_transfer.offset]
			if not link then
				log("FATAL: recevied items for non-existant link at offset " .. belt_transfer.offset)
				return
			end

			push_belt_link(link, belt_transfer.item_stacks)
		end
	end
end

function edge_transports.toggle_debug()
	global.edge_transports.debug_draw = not global.edge_transports.debug_draw
	debug_draw()
end


local edge_logic = {}
edge_logic.events = {
	[clusterio_api.events.on_server_startup] = function(event)
		log("Edge Transports startup")
		if not global.edge_transports then
			global.edge_transports = {}
		end

		if not global.edge_transports.edges then
			global.edge_transports.edges = {}
		end

		if not global.edge_transports.debug_shapes then
			global.edge_transports.debug_shapes = {}
		end

		if not global.edge_transports.ticks_per_edge then
			global.edge_transports.ticks_per_edge = 15
		end
	end,

	[defines.events.on_tick] = function(event)
		local ticks_left = -game.tick % global.edge_transports.ticks_per_edge
		local id = global.edge_transports.current_edge_id
		if id == nil then
			id = next(global.edge_transports.edges)
			if id == nil then
				return -- no edges
			end
			global.edge_transports.current_edge_id = id
		end
		local edge = global.edge_transports.edges[id]

		-- edge may have been removed while iterating over it
		if edge == nil then
			global.edge_transports.current_edge_id = nil
			return
		end

		poll_links(id, edge, ticks_left)

		if ticks_left == 0 then
			global.edge_transports.current_edge_id = next(global.edge_transports.edges, id)
		end
	end,

	[defines.events.on_built_entity] = function(event) on_built(event.created_entity) end,
	[defines.events.on_robot_built_entity] = function(event) on_built(event.created_entity) end,
	[defines.events.script_raised_built] = function(event) on_built(event.entity) end,
	[defines.events.script_raised_revive] = function(event) on_built(event.entity) end,

	[defines.events.on_player_mined_entity] = function(event) on_removed(event.entity) end,
	[defines.events.on_robot_mined_entity] = function(event) on_removed(event.entity) end,
	[defines.events.on_entity_died] = function(event) on_removed(event.entity) end,
	[defines.events.script_raised_destroy] = function(event) on_removed(event.entity) end,
}

return edge_logic
-- vim: noet ts=4
