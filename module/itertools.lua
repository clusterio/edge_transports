local itertools = {}

function itertools.partial_pairs(tbl, state, ticks_left)
	if ticks_left == 0 then
		local index = state.index
		state.index = nil
		state.pos = 0
		return next, tbl, index
	end

	local function iterator(itstate, index)
		if itstate.pos >= itstate.endpoint then
			itstate.index = index
			return nil, nil

		elseif itstate.pos > 0 and index == nil then
			return nil, nil
		end

		itstate.pos = itstate.pos + 1
		itstate.index = next(tbl, index)
		return itstate.index, tbl[itstate.index]
	end

	state.pos = state.pos or 0
	state.endpoint = state.pos + math.max(0, math.ceil((table_size(tbl) - state.pos) / (ticks_left + 1)))
	return iterator, state, state.index
end

return itertools
