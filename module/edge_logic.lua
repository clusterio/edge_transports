local clusterio_api = require("modules/clusterio/api")
local serialize = require("modules/clusterio/serialize")

local itertools = require("itertools")
local vectorutil = require("vectorutil")

local is_transport_belt = {
	["transport-belt"] = true,
	["fast-transport-belt"] = true,
	["express-transport-belt"] = true,
}

local belt_type_to_loader_type = {
	["transport-belt"] = "loader",
	["fast-transport-belt"] = "fast-loader",
	["express-transport-belt"] = "express-loader",
}

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
			text = id .. " " .. (edge.active and "active" or "inactive"),
			target = vectorutil.vec2_add(edge.origin, {0.4, -0.8}),
			surface = edge.surface,
		}

		local dir = vectorutil.dir_to_vec(edge.direction)
		debug_shapes[#debug_shapes + 1] = rendering.draw_line {
			color = { r = 1, g = 0.2, b = 0.2 },
			width = 4,
			from = vectorutil.vec2_add(edge.origin, vectorutil.vec2_smul(dir, 0.25)),
			to = vectorutil.vec2_add(edge.origin, vectorutil.vec2_smul(dir, edge.length - 0.5)),
			surface = edge.surface,
		}
	end
end

local function world_to_edge_pos(pos, edge)
	return vectorutil.vec2_rot(vectorutil.vec2_sub(pos, edge.origin), -edge.direction % 8)
end

local function edge_pos_to_world(edge_pos, edge)
	return vectorutil.vec2_add(vectorutil.vec2_rot(edge_pos, edge.direction), edge.origin)
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

local function spawn_belt_box(offset, edge, is_input, belt_type, surface)
	local edge_x = offset_to_edge_x(offset, edge)

	local loader_pos = edge_pos_to_world({edge_x, -1}, edge)
	local loader_type = belt_type_to_loader_type[belt_type]
	local loader
	if surface.entity_prototype_collides(loader_type, loader_pos, false, edge.direction) then
		-- Is the loader already there?
		loader = surface.find_entity(loader_type, loader_pos)
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
			name = loader_type,
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
			start_index = nil,
			flag_for_removal = nil,
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
	for _, loader_type in pairs(belt_type_to_loader_type) do
		local loader = surface.find_entity(loader_type, loader_pos)
		if loader then
			loader.destroy()
		end
	end
end

local function create_belt_link(id, edge, offset, entity)
	local is_input = entity.direction == edge.direction
	spawn_belt_box(offset, edge, is_input, entity.name, entity.surface)
	clusterio_api.send_json("edge_transports:edge_link_update", {
		type = "create_belt_link",
		edge_id = id,
		data = {
			offset = offset,
			is_input = not is_input,
			belt_type = entity.name,
		},
	})
end

local function on_built(entity)
	if entity.valid and is_transport_belt[entity.name] then
		local pos = {entity.position.x, entity.position.y}
		for id, edge in pairs(global.edge_transports.edges) do
			if edge.active and game.surfaces[edge.surface] == entity.surface then
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
	if entity.valid and is_transport_belt[entity.name] then
		local pos = {entity.position.x, entity.position.y}
		for id, edge in pairs(global.edge_transports.edges) do
			if edge.active and game.surfaces[edge.surface] == entity.surface then
				local offset = belt_check(pos, entity.direction, edge)
				if offset then
					remove_belt_link(id, edge, offset, entity)
					break
				end
			end
		end
	end
end

local function poll_input_belt_link(offset, link)
	if not link.chest or not link.chest.valid then
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

local function poll_output_belt_link(offset, link)
	if not link.chest or not link.chest.valid then
		return
	end

	local inventory = link.chest.get_inventory(defines.inventory.chest)
	if link.start_index and not inventory[link.start_index].valid_for_read then
		link.start_index = nil
		return {
			offset = offset,
			set_flow = true,
		}
	end
end

-- Shift the item in the inventory up by the given count of slots
local function shift_inventory(inventory, shift)
	if inventory.is_empty() then
		return shift, shift
	end

	local _, current_index = inventory.find_empty_stack()
	if not current_index then
		return 0, #inventory
	end

	current_index = current_index - 1
	local current_shift = 1
	if current_shift < shift then
		for index = current_index + current_shift, #inventory do
			if inventory[index].valid_for_read then
				break
			end
			current_shift = index - current_index
			if current_shift >= shift then
				break
			end
		end
	end
	local shift_top = current_index + shift

	-- Shift up the item stacks
	while current_index >= 1 do
		inventory[current_index + current_shift].transfer_stack(inventory[current_index])
		current_index = current_index - 1
	end

	return current_shift, shift_top
end

local function push_belt_link(offset, link, item_stacks)
	if not link.chest or not link.chest.valid then
		log("FATAL: recevied items but target chest does not exist at off " .. offset)
		return
	end

	local inventory = link.chest.get_inventory(defines.inventory.chest)
	local item_stacks_count = #item_stacks
	local space, top_index = shift_inventory(inventory, item_stacks_count)
	for index=1, space do
		local slot = inventory[space - index + 1]
		serialize.deserialize_item_stack(slot, item_stacks[index])
		item_stacks[index] = nil
	end

	if item_stacks_count > space then
		for index=1, space - item_stacks_count do
			item_stacks[index] = item_stacks[index + space]
		end

		link.start_index = math.floor(#inventory / 2 + 1)
		log("FATAL: item stacks left over!")

	elseif not link.start_index and top_index > item_stacks_count * 2 + 2 then
		link.start_index = math.min(item_stacks_count + 2, #inventory)
	end

	if link.start_index then
		return {
			offset = offset,
			set_flow = false,
		}
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
		local update
		if link.is_input then
			update = poll_input_belt_link(offset, link)
		else
			update = poll_output_belt_link(offset, link)
		end

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
				active = false,
				linked_belts = nil,
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
				edges[edge.id].active = false
			end
		end
	end

	for id, _edge in pairs(edges) do
		if not new_edge_ids[id] then
			edges[id] = nil
		end
	end

	if global.edge_transports.debug_draw then
		debug_draw()
	end
end

function edge_transports.set_active_edges(json)
	local active_edges = game.json_to_table(json)
	local active_edges_map = {}
	for _, edge_id in ipairs(active_edges) do
		active_edges_map[edge_id] = true
	end

	for edge_id, edge in pairs(global.edge_transports.edges) do
		edge.active = active_edges_map[edge_id] == true

		if not edge.active then
			if edge.linked_belts then
				for _offset, link in pairs(edge.linked_belts) do
					if link.is_input and link.chest and link.chest.valid then
						local inventory = link.chest.get_inventory(defines.inventory.chest)
						inventory.set_bar(1)
					end
				end
			end

		else
			if edge.linked_belts then
				for _offset, link in pairs(edge.linked_belts) do
					if not link.is_input then
						link.start_index = 1
					end
				end
			end
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
		spawn_belt_box(data.offset, edge, data.is_input, data.belt_type, surface)

	elseif update.type == "remove_belt_link" then
		remove_belt_box(data.offset, edge, surface)

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

	local response_transfers = {}
	if data.belt_transfers then
		for _offset, belt_transfer in ipairs(data.belt_transfers) do
			local link = (edge.linked_belts or {})[belt_transfer.offset]
			if not link then
				log("FATAL: recevied items for non-existant link at offset " .. belt_transfer.offset)
				return
			end

			if link.is_input and belt_transfer.set_flow ~= nil then
				local inventory = link.chest.get_inventory(defines.inventory.chest)
				if belt_transfer.set_flow then
					inventory.set_bar()
				else
					inventory.set_bar(1)
				end
			end

			if belt_transfer.item_stacks then
				local update = push_belt_link(belt_transfer.offset, link, belt_transfer.item_stacks)
				if update then
					response_transfers[#response_transfers + 1] = update
				end
			end
		end
	end

	if #response_transfers > 0 then
		clusterio_api.send_json("edge_transports:transfer", {
			edge_id = data.edge_id,
			belt_transfers = response_transfers,
		})
	end
end

function edge_transports.toggle_debug()
	global.edge_transports.debug_draw = not global.edge_transports.debug_draw
	debug_draw()
end


local edge_logic = {}
edge_logic.events = {
	[clusterio_api.events.on_server_startup] = function(_event)
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

		edge_transports.set_active_edges("[]")
	end,

	[defines.events.on_tick] = function(_event)
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

		if edge.active then
			poll_links(id, edge, ticks_left)
		end

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
