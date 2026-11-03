--@input float duration = 1.5{"widget":"slider","min":0.1,"max":6.0}
--@input float time = 0.0{"widget":"slider","min":0.1,"max":6.0}

-- config sprite
local spriteScaleConst = 0.7
local spriteRotateSpeed = -250
local charScale = 0.6
local charOffset = -0.6

-- config for editor
local editor = {
	enable = false,
	time = 0,
}


local exports = exports or {}
local TextAnim = TextAnim or {}
TextAnim.__index = TextAnim
function TextAnim.new(construct, ...)
	local self = setmetatable({}, TextAnim)

	self.spriteMaterial = nil
	self.time = 0
	self.duration = 3.0
    self.count = 0
	self.tweens = {}
	self.curtime = 0
	self.typeSettingKind = nil
	self.initTimes = -3
	self.localPositionZ = 0
	self.PreTime = -1
	self.FirstCharOfRow = {}
	self.random_tween_time1 = {0.86,1.35,0.62,2.2,0.25,0.96,0.35,2.55,0.03,0.82,0.2,1.26,0.36,0.1}
	self.random_tween_time = {0.86,1.35,0.62,5.2,0.25,0.96,0.35,4.55,0.03,0.82,0.2,1.26,0.36,0.1}
	if construct and TextAnim.constructor then TextAnim.constructor(self, ...) end
    return self
end

function TextAnim:constructor()

end

function TextAnim:reset()
	local text = self.text
	if text then
		local chars = text.chars
		local charCount = chars:size()
		for i = 0, charCount - 1 do
			local char = chars:get(i)
			if char.rowth ~= -1 then
				char.position = char.initialPosition
				char.rotate = Amaz.Vector3f(0, 0, 0)
				char.scale = Amaz.Vector3f(1, 1, 1)
			end
		end
		self.text.chars = chars
	end

	for key, value in pairs(self.tweens) do
    	value:set(self.duration)
        value:clear()
    end 
	self.tweens = {}

	if self.sprites then
		for i = 1, #self.sprites do
			local s = self.sprites[i]
			s.sprite.enabled = false
		end
	end
end


function TextAnim:CheckChinese(s) 
	local ret = {};
	local f = '[%z\1-\127\194-\244][\128-\191]*';
	local line, lastLine, isBreak = '', false, false;
	for v in s:gfind(f) do
		local isChinese = (#v~=1)
		if isChinese then
			return true
		end
	end
	return false;
end

function TextAnim:isDigital(s) 
	if tonumber(s) then
		return true
	end
	return false
end


function TextAnim:isAlphabet(s)
	if string.match(s,"%a") then
		return true
	else 
		return false
	end
end
	
function TextAnim:getCharPt(char_index,time)
	local total_time = 0;
	local all_time = 0
	for index, value in ipairs(self.action_time) do
		if index < char_index then
			total_time = total_time + value

		end
		all_time = all_time + value
	end
	local passtime = self.action_time[char_index] 
	Amaz.LOGI("======>>wiwiiw",total_time.."oo"..passtime)
	if time < total_time then
		return 0
	elseif time >= total_time and time < total_time + passtime then
		local tt = (time-total_time)/passtime
		Amaz.LOGI("===zzmm\n\n\n",tt)
		-- if passtime/all_time >= 10/50*2.0/self.duration then
		-- 	Amaz.LOGI("===zz\n\n\n",tt)
		-- 	if tt < 0.4 then
		-- 		self.curpt = 0.0
		-- 	elseif tt >=0.4 and tt < 0.55 then
		-- 		self.curpt = 0.5
		-- 	else
		-- 		self.curpt = 1.0
		-- 	end
		if passtime/all_time >= 6/50*2.0/self.duration then
			Amaz.LOGI("===aazz\n\n\n",tt)
			if tt < 0.5 then
				self.curpt = 1.0
			elseif tt>=0.5 and tt < 0.85 then
				self.curpt = (0.85-tt)/0.25
			else
				self.curpt = 0.0
			end
		else
			self.curpt = 1.0
		end
		--next char have animation
		if tt> 0.9 then
			-- local next_passtime = self.action_time[char_index+1] 
			-- if next_passtime/all_time >= 5/50*2.0/self.duration then
				self.curpt = 1.0
			-- end
		end
		return tt > 0.9 and 1.0 or 0.0
	else

		if char_index < self.count then

			local next_char = self.text.chars:get(char_index )
			if next_char.color.w == 0 then
				local next_passtime = self.action_time[char_index+1] 
				-- if next_passtime/all_time >= 6/50*2.0/self.duration then
					self.curpt = 1.0
				-- end
			end

			if char_index == self.count - 1 then
				self.curpt = 1.0
			end
		end
		return 1.0
	end
end

function TextAnim:checkDirty(time)
	if self.text~= nil then
		self.tweens = {}
		local chars = self.text.chars
		self.count = chars:size()
		local len = self.count 
		for i = 1, len do
			local char = self.text.chars:get(i - 1)
			if self.FirstCharOfRow[char.rowth] then
				if (self:CheckChinese(char.utf8code) and char.utf8code ~= "“"and char.utf8code ~= "”"and char.utf8code ~= "‘"and char.utf8code ~= "’")or self:isDigital(char.utf8code) or self:isAlphabet(char.utf8code) then
					self.FirstCharOfRow[char.rowth] = i - 1
				end
			else
				self.FirstCharOfRow[char.rowth] = i - 1
			end

			local charpt = self:getCharPt(i,1.2*time/self.duration)			
			char.color = Amaz.Vector4f(char.color.x,char.color.y,char.color.z,charpt)

		end
	end
	return true
end


function TextAnim:onStart(comp)
    self.text = comp.entity:getComponent('SDFText')
    if self.text == nil then
        local text = comp.entity:getComponent('Text')
        if text ~= nil then
            self.text = comp.entity:addComponent('SDFText')
            self.text:setTextWrapper(text)
        end
    end
	self.text_rich = comp.entity:getComponent("Text")
	self.comp = comp
	self.trans = self.comp.entity:getComponent("Transform")
	self.trans.localScale = Amaz.Vector3f(1, 1, 1)
	self.trans.localEulerAngle = Amaz.Vector3f(0, 0, 0)

	if editor.enable then
		self.spriteMaterial = self.comp.entity:getComponent('Transform').parent.entity:getComponent('MeshRenderer').sharedMaterials:get(0)
	end
	self.sprites = { }
	local i = 1
	local s = { }
	s.spriteTrans = self.comp.entity.scene:createEntity('sprite'):addComponent('Transform')
	self.trans:addTransform(s.spriteTrans)
	s.spriteTrans.localPosition = Amaz.Vector3f(0, 0, 0)
	s.spriteTrans.localEulerAngle = Amaz.Vector3f(0, 0, 0)
	s.sprite = s.spriteTrans.entity:addComponent('Sprite2DRenderer')
	s.sprite.stretchMode = Amaz.StretchMode.texture_size

	local materials = Amaz.Vector()
	materials:pushBack(self.spriteMaterial)
	s.sprite.sharedMaterials = materials
	s.material = s.sprite.materials:get(0)
	s.material.renderQueue = i
	s.material:setFloat('alpha', 1.0)
	s.material:setFloat('curalpha', 1.0)
	local tex = s.material:getTex('_MainTex')
	s.sprite.enabled = false
	s.imageSize = { w = tex.width, h = tex.height }

	self.sprites[#self.sprites + 1] = s

	self.text.outlineMaxWidth = 0.2
	self.localPosition = comp.entity:getComponent("Transform").localPosition
	self.typeSettingKind = self.text.typeSettingKind
	self.oriCount = self.text.chars:size()
	self.action_time = {}
	local randomtime = self.random_tween_time
	local len = #randomtime
	if self.duration/self.oriCount >= 0.15 then
		randomtime = self.random_tween_time1
	end
	local total_num = 0

	for i = 1, self.oriCount do
		local index = (i-1)%(len)
		table.insert(self.action_time,randomtime[index+1])
		total_num = total_num + randomtime[index+1]
	end

	for index, value in ipairs(self.action_time) do
		self.action_time[index] = self.action_time[index]/total_num
		-- Amaz.LOGI("=====>hh",index.."=="..self.action_time[index])
	end

	local chars = self.text.chars
	self.count = chars:size()

end


function TextAnim:refreshrandomTime()
	self.action_time = {}
	local randomtime = self.random_tween_time
	local len = #randomtime
	if self.duration/self.oriCount >= 0.15 then
		randomtime = self.random_tween_time1
	end
	local total_num = 0

	for i = 1, self.oriCount do
		local index = (i-1)%(len)
		table.insert(self.action_time,randomtime[index+1])
		total_num = total_num + randomtime[index+1]
	end

	for index, value in ipairs(self.action_time) do
		self.action_time[index] = self.action_time[index]/total_num
	end
end

function TextAnim:onUpdate(comp, deltaTime)

end

function TextAnim:getavePosy(c)
	local c_row = c.rowth

	local len = self.count 
	local ave_posy = 0
	local count = 0
	for i = 1, len do
		local char = self.text.chars:get(i - 1)
		if char.rowth == c_row then
			ave_posy = ave_posy + char.initialPosition.y
			count = count + 1
		end
	end
	if count > 0 then
		ave_posy = ave_posy/count
	end
	return ave_posy;
end


function TextAnim:getavePosX(c)
	local c_row = c.rowth

	local len = self.count 
	local ave_posx = 0
	local count = 0
	for i = 1, len do
		local char = self.text.chars:get(i - 1)
		if char.rowth == c_row then
			ave_posx = ave_posx + char.initialPosition.x
			count = count + 1
		end
	end
	if count > 0 then
		ave_posx = ave_posx/count
	end
	return ave_posx;
end


function TextAnim:getaveWidth(c)
	local c_row = c.rowth

	local len = self.count 
	local ave_width = 0
	local count = 0
	for i = 1, len do
		local char = self.text.chars:get(i - 1)
		if char.rowth == c_row then
			ave_width = ave_width + char.width
			count = count + 1
		end
	end
	if count > 0 then
		ave_width = ave_width/count
	end
	return ave_width;
end



local function computeSpriteTransform(self, t, chars, spriteH)
	local charCount = chars:size()
	local charT = 1.0 / (charCount + 1 + 0.5)

	local len = self.count 
	local index = 0
	for i = 1, len do
		local char = self.text.chars:get(i - 1)
		if char.color.w == 0 and index == 0 then
			index = i-1
		end
	end
	local char = self.text.chars:get(len - 1)
	local firstchar = self.text.chars:get(0)
	if char.color.w == 1 then 
		index = len 
	end
	if firstchar == char then
		index = 1
	end
	local c = nil
	c = chars:get(index-1)

	local rect = self.text.rect
	local rectCenterY = rect.y + rect.height / 2

	local rectCenterX = rect.x + rect.width / 2
	local x = c.position.x + c.width*0.32

	-- if char.color.w == 1 then --last char
	-- 	x = x + c.width*0.5 
	-- end
	if firstchar.color.w == 0 then
		x = c.position.x 
	end
	
	local charCount = chars:size()
	local avgCharSize = 0
	if charCount then
		local spriteScale = 1.0
		local totalCharSize = 0
		for i = 1, charCount do
			local c1 = chars:get(i - 1)
			totalCharSize = totalCharSize +  c1.width
		end
		avgCharSize = totalCharSize / charCount
	end


	local ave_pos_y = self:getavePosy(c)
	local y = ave_pos_y + rectCenterY + avgCharSize*0.1
	self.preIndex = index

	-- Amaz.LOGI("oooooooo:\n\n\n",index.."==="..charCount.."=="..x.."==="..c.position.x.."==="..c.width/2)
	if c.utf8code == "\n" then
		if index < charCount then
			local next_char = chars:get(index)
			x = next_char.position.x
			ave_pos_y = self:getavePosy(next_char)
			y = ave_pos_y + rectCenterY + avgCharSize*0.1
		end

	end


	if self.typeSettingKind == Amaz.TypeSettingKind.VERTICAL then
		x = self:getavePosX(c)+ avgCharSize*0.18
		y = c.position.y - c.width/2.
		if firstchar.color.w == 0 then
			y = c.position.y 
		end
    end

	x = x * 1.0 / (Amaz.BuiltinObject.getOutputTextureHeight() / 2)
	local pixelToUnit = 1.0 / (Amaz.BuiltinObject.getOutputTextureHeight() / 2)

	y = y * pixelToUnit
	local deg = spriteRotateSpeed * t * self.duration
	return { x = x, y = y, deg = deg }
end


local function release(self)
	if self.sprites then
		for i = 1, #self.sprites do
			local s = self.sprites[i]
			self.comp.entity.scene:removeEntity(s.sprite.entity)
		end
		self.sprites = nil
	end
end

function TextAnim:getcuralpha()

end

function TextAnim:seek(time)
	local t = time/ self.duration
	self:refreshrandomTime()
	if self:checkDirty(time) == false then
		return
	end
	for key, value in pairs(self.tweens) do
    	value:set(time)
	end
	-- get text render order and queue
	local textRenderer = self.text:getRenderer()
	local sortingOrder = textRenderer.sortingOrder
	local renderQueue = 0
	local textMaterials = textRenderer.materials
	if textMaterials then
		local textMaterialsCount = textMaterials:size()
		for i = 0, textMaterialsCount - 1 do
			local material = textMaterials:get(i)
			if renderQueue < material.renderQueue then
				renderQueue = material.renderQueue
			end
		end
	end

	local chars = self.text.chars

	self.text:forceTypeSetting()
	if self.text_rich.forceFlushCommandQueue then
		self.text_rich:forceFlushCommandQueue()
	end

	local charCount = chars:size()
	if charCount > 0 and t<=1.0 then
		local spriteScale = 1.0
		local totalCharSize = 0
		for i = 1, charCount do
			local c = chars:get(i - 1)
			totalCharSize = totalCharSize + math.max(c.width, c.height)
		end
		local avgCharSize = totalCharSize / charCount
		local spriteH = 0
		local i= 1
		local s = self.sprites[i]
		s.sprite.enabled = true
		s.sprite.entity.layer = self.comp.entity.layer

		spriteScale = avgCharSize / math.max(s.imageSize.w, s.imageSize.h) * spriteScaleConst

		local fix_scale = spriteScale/0.3
		if fix_scale < 1.0 then
			fix_scale = 1.0-(1.0-fix_scale)
		elseif fix_scale >= 1.0 then
			fix_scale = 1.0+0.2*(fix_scale-1.0)
		end

		spriteH = spriteScale * math.max(s.imageSize.w, s.imageSize.h)
        self.text.outlineMaxWidth = 0.2
		local st = t --+ spriteTimeOffsets[i]
		local ret = computeSpriteTransform(self, st, chars, spriteH)
		ret.x = ret.x + ( 0.0560*fix_scale*s.imageSize.w/2*0.9)/(Amaz.BuiltinObject.getOutputTextureHeight() / 2)

		if self.typeSettingKind == Amaz.TypeSettingKind.VERTICAL then
			ret.y = ret.y + 0.0560*fix_scale*s.imageSize.w/2*0.9/(Amaz.BuiltinObject.getOutputTextureHeight() / 2)
		end
		s.spriteTrans.localPosition = Amaz.Vector3f(ret.x, ret.y, 0)
		s.spriteTrans.localEulerAngle = Amaz.Vector3f(0, 0, 0.0)
		if self.typeSettingKind == Amaz.TypeSettingKind.VERTICAL then
			s.spriteTrans.localEulerAngle = Amaz.Vector3f(0, 0, 90.0)
		end
		s.spriteTrans.localScale = Amaz.Vector3f(0.0560*fix_scale, spriteScale*1.4, 1)
		s.sprite.sortingOrder = sortingOrder
		s.material.renderQueue = renderQueue + i
		-- end
		if st > 0.94 then
			self.curpt = 1.0-(st - 0.94)/0.06
		end
		if st > 0.88 and st <= 0.94 then
			self.curpt = 1.0
		end
		s.material:setFloat('curalpha', self.curpt or 1.0)
		local charCount = chars:size()
		local charT = 1.0 / (charCount + 1 + 0.5)
		local index = math.floor(st / charT)
		-- if index == 0 then
		-- 	self:reset()
		-- end

		index = charCount - index
		self.text.chars = chars
	else
		self:reset()
	end
end

function TextAnim:setDuration(duration)
	if math.abs(duration - self.duration) > 0.01 then
		self.duration = duration
	end
end


function TextAnim:resetData()
	local chars = self.text.chars 
	local charCount = chars:size()
	for i = 1, charCount do
		local char = chars:get(i-1)
		char.color = Amaz.Vector4f(char.color.x,char.color.y,char.color.z,1.0)
	end
end

function TextAnim:clear()
	self:resetData()
	release(self)
end

function TextAnim:onEnter()
end

function TextAnim:onLeave()
	self:resetData()
	self:reset()
end


exports.TextAnim = TextAnim
return exports
