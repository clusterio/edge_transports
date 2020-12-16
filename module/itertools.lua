local itertools = {}

function itertools.partial_pairs(tbl, state, ticks_left)
	if ticks_left == 0 then
		local index = state.index
		state.index = nil
		state.pos = 0
		return next, tbl, index
	end

	function iterator(state, index)
		if state.pos >= state.endpoint then
			state.index = index
			return nil, nil

		elseif state.pos > 0 and index == nil then
			return nil, nil
		end

		state.pos = state.pos + 1
		state.index = next(tbl, index)
		return state.index, tbl[state.index]
	end

	state.pos = state.pos or 0
	state.endpoint = state.pos + math.max(0, math.ceil((table_size(tbl) - state.pos) / (ticks_left + 1)))
	return iterator, state, state.index
end

return itertools
