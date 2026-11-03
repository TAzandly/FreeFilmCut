local exports = exports or {}
local TextAnim = TextAnim or {}
local disable_glow_flag_temporary_changed_in_future = true
---@class TextAnim : ScriptComponent
---@field duration number
---@field progress number [UI(Range={0.0, 1.0}, Slider)]
---@field autoPlay boolean
---@field effectMaterial Material
TextAnim.__index = TextAnim
function TextAnim.new(construct, ...)
	local self = setmetatable({}, TextAnim)
	self.text = nil
	self.duration = 3.3
	self.curTime = 0
	self.effectMaterial = nil
	self.first = true
    if construct and TextAnim.constructor then TextAnim.constructor(self, ...) end
    return self
end

function TextAnim:constructor()

end

local function remap(smin, smax, dmin, dmax, value)
	return (value - smin) / (smax - smin) * (dmax - dmin) + dmin
end

local ae_attribute = {
	["ADBE_Position_0_0"]={
		{{0.43935, 0.195167, 0.357726, 0.544422, }, {0, 30, }, {{187.125, 326.529998779, 0, }, {592.938868853, 326.533112577, 0, }, }, }, 
		{{0.16037, 0.700889, 1, 1, }, {30, 75, }, {{592.938868853, 326.533112577, 0, }, {774.0625, 326.529998779, 0, }, }, }, 
	}, 
}

function TextAnim:setMatToSDFText()
    self.text.renderToRT = true
    local materials = Amaz.Vector()
    local InsMaterials = nil
    if self.effectMaterial then
        InsMaterials = self.effectMaterial:instantiate()
    else
        InsMaterials = self.renderer.material
    end
    materials:pushBack(InsMaterials)
    self.materials = materials
    self.renderer.materials = self.materials

    self.material = self.renderer.material

end

function TextAnim:getTextColor()
    local text = self.text.entity:getComponent("Text")
    local textColor = Amaz.Vector3f(1.0,1.0,1.0)
    if text then --
        if text.forceFlushCommandQueue then
            text:forceFlushCommandQueue()
        end
        local letters = text.letters
        if letters:size() > 0 then
            local letter0 = letters:get(0)
            textColor = letter0 and letter0.letterStyle and letter0.letterStyle.letterColor
        end
    else
        textColor = Amaz.Vector3f(self.text.textColor.x,
                                self.text.textColor.y,
                                self.text.textColor.z)
    end
    return textColor
end

function TextAnim:onStart(comp) 
	self.text = comp.entity:getComponent('SDFText')
	local text = comp.entity:getComponent('Text')
	self.textComp = text
    if self.text == nil then
        local text = comp.entity:getComponent('Text')
		self.textComp = text
        if text ~= nil then
			self.text = comp.entity:addComponent('SDFText')
            self.text:setTextWrapper(text)
        end
    end
	self.trans = comp.entity:getComponent("Transform")
	if self.text ~= nil then
		self.renderer = comp.entity:getComponent("MeshRenderer")
	else
		self.renderer = comp.entity:getComponent("Sprite2DRenderer")
	end
    self.attrs = includeRelativePath("AETools"):new(ae_attribute)

	Amaz.LOGI("zyl", "on start test")
	-- Change glow intensity
	-- self.renderer.material:setFloat("u_GlowIntensity", 2.0)
	self.richText = comp.entity:getComponent("Text")
	self:seek(0)
end

function TextAnim:onUpdate(comp, time)
    if Amaz.Macros and Amaz.Macros.EditorSDK then
		local t = 0
		if self.autoPlay then
			self.curTime = self.curTime + time
			t = self.curTime - math.floor(self.curTime / self.duration) * self.duration
        end
        self:seek(t)
	else
		self.curTime = 0
    end
end


function TextAnim:seek(time)
	local progress = time / self.duration
	
	if self.text == nil then
		return 
	end

	
	if self.first then
		self:setMatToSDFText()
		self.first = false
		Amaz.LOGI("zyl material set glow", 11)
		self.renderer.material:setFloat("u_GlowIntensity", 2.0)
		self.renderer.material:setVec4("u_TextColor", Amaz.Vector4f(1.0,1.0,1.0,1.0))
		Amaz.LOGI("zyl material set glow", 22)

		if self.richText.bloomEnable and disable_glow_flag_temporary_changed_in_future then
			self.oriBloomEnabled = self.richText.bloomEnable
			self.richText.bloomEnable = false
		end
	end

	self.renderer.material:setVec3("u_letterCol", self:getTextColor())
	Amaz.LOGI("Zyl text color", tostring(self:getTextColor()))
	local startX = 187.125
	local endX = 774.06
	local value = self.attrs:GetVal("ADBE_Position_0_0", progress)[1] 
	self.renderer.material:setFloat("u_cutPos", (value-startX) / (endX-startX))
	Amaz.LOGI("Zyl cut pos", tostring((value-startX) / (endX-startX)))
	local expandSize = self.text:getRectExpanded()
	expandSize = Amaz.Vector4f(expandSize.x, expandSize.y, expandSize.width, expandSize.height)
	self.renderer.material:setVec4("u_rtSize", expandSize)
	Amaz.LOGI("Zyl u_rtSize", tostring(expandSize))

    local chars = self.text.chars 
    self.text.chars= chars
end

function TextAnim:onEnter()
	self.first = true
end

function TextAnim:resetData( ... )
	if self.text ~= nil then
    	local chars = self.text.chars 
		for i = 1, self.text.chars:size() do
			local char = chars:get(i - 1)
			if char.rowth ~= -1 then
				char.position = char.initialPosition
				char.rotate = Amaz.Vector3f(0, 0, 0)
				char.scale = Amaz.Vector3f(1, 1, 1)
				char.color = Amaz.Vector4f(char.color.x, char.color.y, char.color.z, 1)
			end
		end
		self.text.chars = chars
	end
    self.text.renderToRT = false

	self.trans.localPosition = Amaz.Vector3f(0, 0, 0)
	self.trans.localEulerAngle = Amaz.Vector3f(0, 0, 0)
	self.trans.localScale = Amaz.Vector3f(1, 1, 1)

	if self.oriBloomEnabled then
        self.richText.bloomEnable = self.oriBloomEnabled
    end
end

function TextAnim:setDuration(duration)
   self.duration = duration
end
function TextAnim:onLeave()
	self:resetData()
	self.first = true
end
function TextAnim:clear()
	self:resetData()
	self.first = true
end

exports.TextAnim = TextAnim
return exports
