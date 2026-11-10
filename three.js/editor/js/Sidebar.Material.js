import * as THREE from 'three';

import { UIButton, UIInput, UIPanel, UIRow, UISelect, UIText, UITextArea } from './libs/ui.js';

import { SetMaterialCommand } from './commands/SetMaterialCommand.js';
import { SetMaterialValueCommand } from './commands/SetMaterialValueCommand.js';

import { SidebarMaterialBooleanProperty } from './Sidebar.Material.BooleanProperty.js';
import { SidebarMaterialColorProperty } from './Sidebar.Material.ColorProperty.js';
import { SidebarMaterialConstantProperty } from './Sidebar.Material.ConstantProperty.js';
import { SidebarMaterialMapProperty } from './Sidebar.Material.MapProperty.js?v=fcc-ui-106';
import { SidebarMaterialNumberProperty } from './Sidebar.Material.NumberProperty.js';
import { SidebarMaterialRangeValueProperty } from './Sidebar.Material.RangeValueProperty.js';
import { SidebarMaterialProgram } from './Sidebar.Material.Program.js';
import { SidebarMaterialShaderUniforms } from './Sidebar.Material.ShaderUniforms.js?v=fcc-ui-236';
import { createFreeFilmCutShaderMaterial, syncShaderMaterialBridge } from './FreeCapCutShaders.js?v=fcc-ui-198';
import { resolveSidebarMeshObject } from './ui/UIConstants.js?v=fcc-ui-159';

function SidebarMaterial( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	let currentObject;

	let currentMaterialSlot = 0;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setDisplay( 'none' );
	container.setPaddingTop( '20px' );

	// Current material slot

	const materialSlotRow = new UIRow();

	materialSlotRow.add( new UIText( strings.getKey( 'sidebar/material/slot' ) ).setClass( 'Label' ) );

	const materialSlotSelect = new UISelect().setWidth( '170px' ).setFontSize( '12px' ).onChange( update );
	materialSlotSelect.setOptions( { 0: '' } ).setValue( 0 );
	materialSlotRow.add( materialSlotSelect );

	container.add( materialSlotRow );

	// type

	const materialClassRow = new UIRow();
	const materialClass = new UISelect().setWidth( '150px' ).setFontSize( '12px' ).onChange( update );

	materialClassRow.add( new UIText( strings.getKey( 'sidebar/material/type' ) ).setClass( 'Label' ) );
	materialClassRow.add( materialClass );

	container.add( materialClassRow );

	// uuid

	const materialUUIDRow = new UIRow();
	const materialUUID = new UIInput().setWidth( '102px' ).setFontSize( '12px' ).setDisabled( true );
	const materialUUIDRenew = new UIButton( strings.getKey( 'sidebar/material/newUuid' ) ).setMarginLeft( '7px' );
	materialUUIDRenew.onClick( function () {

		materialUUID.setValue( THREE.MathUtils.generateUUID() );
		update();

	} );

	materialUUIDRow.add( new UIText( strings.getKey( 'sidebar/material/uuid' ) ).setClass( 'Label' ) );
	materialUUIDRow.add( materialUUID );
	materialUUIDRow.add( materialUUIDRenew );

	container.add( materialUUIDRow );

	// name

	const materialNameRow = new UIRow();
	const materialName = new UIInput().setWidth( '150px' ).setFontSize( '12px' ).onChange( function () {

		editor.execute( new SetMaterialValueCommand( editor, currentObject || editor.selected, 'name', materialName.getValue(), currentMaterialSlot ) );

	} );

	materialNameRow.add( new UIText( strings.getKey( 'sidebar/material/name' ) ).setClass( 'Label' ) );
	materialNameRow.add( materialName );

	container.add( materialNameRow );


	// FreeFilmCut: explicit create / clone (UUID "New" only renews id — confusing for artists)
	const materialActionsRow = new UIRow();
	materialActionsRow.add( new UIText( strings.getKey( 'sidebar/material/actions' ) ).setClass( 'Label' ) );

	const createMaterialBtn = new UIButton( strings.getKey( 'sidebar/material/create' ) );
	createMaterialBtn.setMarginRight( '4px' );
	createMaterialBtn.onClick( function () {

		const type = materialClass.getValue() || 'MeshStandardMaterial';
		createAndAssignMaterial( type );

	} );
	materialActionsRow.add( createMaterialBtn );

	const createShaderBtn = new UIButton( strings.getKey( 'sidebar/material/createShader' ) );
	createShaderBtn.setMarginRight( '4px' );
	createShaderBtn.onClick( function () {

		createAndAssignMaterial( 'ShaderMaterial', { openFrag: true } );

	} );
	materialActionsRow.add( createShaderBtn );

	const cloneMaterialBtn = new UIButton( strings.getKey( 'sidebar/material/clone' ) );
	cloneMaterialBtn.onClick( function () {

		cloneAndAssignMaterial();

	} );
	materialActionsRow.add( cloneMaterialBtn );

	container.add( materialActionsRow );

	// program

	const materialProgram = new SidebarMaterialProgram( editor, 'vertexShader' );
	container.add( materialProgram );

	// color

	const materialColor = new SidebarMaterialColorProperty( editor, 'color', strings.getKey( 'sidebar/material/color' ) );
	container.add( materialColor );

	// FreeFilmCut: custom ShaderMaterial uniforms (color2, floats, bools)
	const materialShaderUniforms = new SidebarMaterialShaderUniforms( editor );
	container.add( materialShaderUniforms );

	// specular

	const materialSpecular = new SidebarMaterialColorProperty( editor, 'specular', strings.getKey( 'sidebar/material/specular' ) );
	container.add( materialSpecular );

	// shininess

	const materialShininess = new SidebarMaterialNumberProperty( editor, 'shininess', strings.getKey( 'sidebar/material/shininess' ) );
	container.add( materialShininess );

	// emissive

	const materialEmissive = new SidebarMaterialColorProperty( editor, 'emissive', strings.getKey( 'sidebar/material/emissive' ) );
	container.add( materialEmissive );

	// reflectivity

	const materialReflectivity = new SidebarMaterialNumberProperty( editor, 'reflectivity', strings.getKey( 'sidebar/material/reflectivity' ) );
	container.add( materialReflectivity );

	// ior

	const materialIOR = new SidebarMaterialNumberProperty( editor, 'ior', strings.getKey( 'sidebar/material/ior' ), [ 1, 2.333 ], 3 );
	container.add( materialIOR );

	// roughness

	const materialRoughness = new SidebarMaterialNumberProperty( editor, 'roughness', strings.getKey( 'sidebar/material/roughness' ), [ 0, 1 ] );
	container.add( materialRoughness );

	// metalness

	const materialMetalness = new SidebarMaterialNumberProperty( editor, 'metalness', strings.getKey( 'sidebar/material/metalness' ), [ 0, 1 ] );
	container.add( materialMetalness );

	// clearcoat

	const materialClearcoat = new SidebarMaterialNumberProperty( editor, 'clearcoat', strings.getKey( 'sidebar/material/clearcoat' ), [ 0, 1 ] );
	container.add( materialClearcoat );

	// clearcoatRoughness

	const materialClearcoatRoughness = new SidebarMaterialNumberProperty( editor, 'clearcoatRoughness', strings.getKey( 'sidebar/material/clearcoatroughness' ), [ 0, 1 ] );
	container.add( materialClearcoatRoughness );

	// dispersion

	const materialDispersion = new SidebarMaterialNumberProperty( editor, 'dispersion', strings.getKey( 'sidebar/material/dispersion' ), [ 0, 10 ] );
	container.add( materialDispersion );

	// iridescence

	const materialIridescence = new SidebarMaterialNumberProperty( editor, 'iridescence', strings.getKey( 'sidebar/material/iridescence' ), [ 0, 1 ] );
	container.add( materialIridescence );

	// iridescenceIOR

	const materialIridescenceIOR = new SidebarMaterialNumberProperty( editor, 'iridescenceIOR', strings.getKey( 'sidebar/material/iridescenceIOR' ), [ 1, 5 ] );
	container.add( materialIridescenceIOR );

	// iridescenceThicknessMax

	const materialIridescenceThicknessMax = new SidebarMaterialRangeValueProperty( editor, 'iridescenceThicknessRange', strings.getKey( 'sidebar/material/iridescenceThicknessMax' ), false, [ 0, Infinity ], 0, 10, 1, 'nm' );
	container.add( materialIridescenceThicknessMax );

	// sheen

	const materialSheen = new SidebarMaterialNumberProperty( editor, 'sheen', strings.getKey( 'sidebar/material/sheen' ), [ 0, 1 ] );
	container.add( materialSheen );

	// sheen roughness

	const materialSheenRoughness = new SidebarMaterialNumberProperty( editor, 'sheenRoughness', strings.getKey( 'sidebar/material/sheenroughness' ), [ 0, 1 ] );
	container.add( materialSheenRoughness );

	// sheen color

	const materialSheenColor = new SidebarMaterialColorProperty( editor, 'sheenColor', strings.getKey( 'sidebar/material/sheencolor' ) );
	container.add( materialSheenColor );

	// transmission

	const materialTransmission = new SidebarMaterialNumberProperty( editor, 'transmission', strings.getKey( 'sidebar/material/transmission' ), [ 0, 1 ] );
	container.add( materialTransmission );

	// attenuation distance

	const materialAttenuationDistance = new SidebarMaterialNumberProperty( editor, 'attenuationDistance', strings.getKey( 'sidebar/material/attenuationDistance' ) );
	container.add( materialAttenuationDistance );

	// attenuation tint

	const materialAttenuationColor = new SidebarMaterialColorProperty( editor, 'attenuationColor', strings.getKey( 'sidebar/material/attenuationColor' ) );
	container.add( materialAttenuationColor );

	// thickness

	const materialThickness = new SidebarMaterialNumberProperty( editor, 'thickness', strings.getKey( 'sidebar/material/thickness' ) );
	container.add( materialThickness );

	// vertex colors

	const materialVertexColors = new SidebarMaterialBooleanProperty( editor, 'vertexColors', strings.getKey( 'sidebar/material/vertexcolors' ) );
	container.add( materialVertexColors );

	// depth packing

	const materialDepthPackingOptions = {
		[ THREE.BasicDepthPacking ]: 'Basic',
		[ THREE.RGBADepthPacking ]: 'RGBA'
	};

	const materialDepthPacking = new SidebarMaterialConstantProperty( editor, 'depthPacking', strings.getKey( 'sidebar/material/depthPacking' ), materialDepthPackingOptions );
	container.add( materialDepthPacking );

	// map

	const materialMap = new SidebarMaterialMapProperty( editor, 'map', strings.getKey( 'sidebar/material/map' ) );
	container.add( materialMap );

	// specular map

	const materialSpecularMap = new SidebarMaterialMapProperty( editor, 'specularMap', strings.getKey( 'sidebar/material/specularmap' ) );
	container.add( materialSpecularMap );

	// emissive map

	const materialEmissiveMap = new SidebarMaterialMapProperty( editor, 'emissiveMap', strings.getKey( 'sidebar/material/emissivemap' ) );
	container.add( materialEmissiveMap );

	// matcap map

	const materialMatcapMap = new SidebarMaterialMapProperty( editor, 'matcap', strings.getKey( 'sidebar/material/matcap' ) );
	container.add( materialMatcapMap );

	// alpha map

	const materialAlphaMap = new SidebarMaterialMapProperty( editor, 'alphaMap', strings.getKey( 'sidebar/material/alphamap' ) );
	container.add( materialAlphaMap );

	// bump map

	const materialBumpMap = new SidebarMaterialMapProperty( editor, 'bumpMap', strings.getKey( 'sidebar/material/bumpmap' ) );
	container.add( materialBumpMap );

	// normal map

	const materialNormalMap = new SidebarMaterialMapProperty( editor, 'normalMap', strings.getKey( 'sidebar/material/normalmap' ) );
	container.add( materialNormalMap );

	// clearcoat map

	const materialClearcoatMap = new SidebarMaterialMapProperty( editor, 'clearcoatMap', strings.getKey( 'sidebar/material/clearcoatmap' ) );
	container.add( materialClearcoatMap );

	// clearcoat normal map

	const materialClearcoatNormalMap = new SidebarMaterialMapProperty( editor, 'clearcoatNormalMap', strings.getKey( 'sidebar/material/clearcoatnormalmap' ) );
	container.add( materialClearcoatNormalMap );

	// clearcoat roughness map

	const materialClearcoatRoughnessMap = new SidebarMaterialMapProperty( editor, 'clearcoatRoughnessMap', strings.getKey( 'sidebar/material/clearcoatroughnessmap' ) );
	container.add( materialClearcoatRoughnessMap );

	// displacement map

	const materialDisplacementMap = new SidebarMaterialMapProperty( editor, 'displacementMap', strings.getKey( 'sidebar/material/displacementmap' ) );
	container.add( materialDisplacementMap );

	// roughness map

	const materialRoughnessMap = new SidebarMaterialMapProperty( editor, 'roughnessMap', strings.getKey( 'sidebar/material/roughnessmap' ) );
	container.add( materialRoughnessMap );

	// metalness map

	const materialMetalnessMap = new SidebarMaterialMapProperty( editor, 'metalnessMap', strings.getKey( 'sidebar/material/metalnessmap' ) );
	container.add( materialMetalnessMap );

	// iridescence map

	const materialIridescenceMap = new SidebarMaterialMapProperty( editor, 'iridescenceMap', strings.getKey( 'sidebar/material/iridescencemap' ) );
	container.add( materialIridescenceMap );

	// sheen color map

	const materialSheenColorMap = new SidebarMaterialMapProperty( editor, 'sheenColorMap', strings.getKey( 'sidebar/material/sheencolormap' ) );
	container.add( materialSheenColorMap );

	// sheen roughness map

	const materialSheenRoughnessMap = new SidebarMaterialMapProperty( editor, 'sheenRoughnessMap', strings.getKey( 'sidebar/material/sheenroughnessmap' ) );
	container.add( materialSheenRoughnessMap );

	// iridescence thickness map

	const materialIridescenceThicknessMap = new SidebarMaterialMapProperty( editor, 'iridescenceThicknessMap', strings.getKey( 'sidebar/material/iridescencethicknessmap' ) );
	container.add( materialIridescenceThicknessMap );

	// env map

	const materialEnvMap = new SidebarMaterialMapProperty( editor, 'envMap', strings.getKey( 'sidebar/material/envmap' ) );
	container.add( materialEnvMap );

	// light map

	const materialLightMap = new SidebarMaterialMapProperty( editor, 'lightMap', strings.getKey( 'sidebar/material/lightmap' ) );
	container.add( materialLightMap );

	// ambient occlusion map

	const materialAOMap = new SidebarMaterialMapProperty( editor, 'aoMap', strings.getKey( 'sidebar/material/aomap' ) );
	container.add( materialAOMap );

	// gradient map

	const materialGradientMap = new SidebarMaterialMapProperty( editor, 'gradientMap', strings.getKey( 'sidebar/material/gradientmap' ) );
	container.add( materialGradientMap );

	// transmission map

	const transmissionMap = new SidebarMaterialMapProperty( editor, 'transmissionMap', strings.getKey( 'sidebar/material/transmissionmap' ) );
	container.add( transmissionMap );

	// thickness map

	const thicknessMap = new SidebarMaterialMapProperty( editor, 'thicknessMap', strings.getKey( 'sidebar/material/thicknessmap' ) );
	container.add( thicknessMap );

	// side

	const materialSideOptions = {
		0: 'Front',
		1: 'Back',
		2: 'Double'
	};

	const materialSide = new SidebarMaterialConstantProperty( editor, 'side', strings.getKey( 'sidebar/material/side' ), materialSideOptions );
	container.add( materialSide );

	// size

	const materialSize = new SidebarMaterialNumberProperty( editor, 'size', strings.getKey( 'sidebar/material/size' ), [ 0, Infinity ] );
	container.add( materialSize );

	// sizeAttenuation

	const materialSizeAttenuation = new SidebarMaterialBooleanProperty( editor, 'sizeAttenuation', strings.getKey( 'sidebar/material/sizeAttenuation' ) );
	container.add( materialSizeAttenuation );

	// flatShading

	const materialFlatShading = new SidebarMaterialBooleanProperty( editor, 'flatShading', strings.getKey( 'sidebar/material/flatShading' ) );
	container.add( materialFlatShading );

	// blending

	const materialBlendingOptions = {
		0: 'No',
		1: 'Normal',
		2: 'Additive',
		3: 'Subtractive',
		4: 'Multiply',
		5: 'Custom'
	};

	const materialBlending = new SidebarMaterialConstantProperty( editor, 'blending', strings.getKey( 'sidebar/material/blending' ), materialBlendingOptions );
	container.add( materialBlending );

	// opacity

	const materialOpacity = new SidebarMaterialNumberProperty( editor, 'opacity', strings.getKey( 'sidebar/material/opacity' ), [ 0, 1 ] );
	container.add( materialOpacity );

	// transparent

	const materialTransparent = new SidebarMaterialBooleanProperty( editor, 'transparent', strings.getKey( 'sidebar/material/transparent' ) );
	container.add( materialTransparent );

	// forceSinglePass

	const materialForceSinglePass = new SidebarMaterialBooleanProperty( editor, 'forceSinglePass', strings.getKey( 'sidebar/material/forcesinglepass' ) );
	container.add( materialForceSinglePass );

	// alpha test

	const materialAlphaTest = new SidebarMaterialNumberProperty( editor, 'alphaTest', strings.getKey( 'sidebar/material/alphatest' ), [ 0, 1 ] );
	container.add( materialAlphaTest );

	// depth test

	const materialDepthTest = new SidebarMaterialBooleanProperty( editor, 'depthTest', strings.getKey( 'sidebar/material/depthtest' ) );
	container.add( materialDepthTest );

	// depth write

	const materialDepthWrite = new SidebarMaterialBooleanProperty( editor, 'depthWrite', strings.getKey( 'sidebar/material/depthwrite' ) );
	container.add( materialDepthWrite );

	// wireframe

	const materialWireframe = new SidebarMaterialBooleanProperty( editor, 'wireframe', strings.getKey( 'sidebar/material/wireframe' ) );
	container.add( materialWireframe );

	// userData

	const materialUserDataRow = new UIRow();
	const materialUserData = new UITextArea().setWidth( '150px' ).setHeight( '40px' ).setFontSize( '12px' ).onChange( update );
	materialUserData.onKeyUp( function () {

		try {

			JSON.parse( materialUserData.getValue() );

			materialUserData.dom.classList.add( 'success' );
			materialUserData.dom.classList.remove( 'fail' );

		} catch ( error ) {

			materialUserData.dom.classList.remove( 'success' );
			materialUserData.dom.classList.add( 'fail' );

		}

	} );

	materialUserDataRow.add( new UIText( strings.getKey( 'sidebar/material/userdata' ) ).setClass( 'Label' ) );
	materialUserDataRow.add( materialUserData );

	container.add( materialUserDataRow );

	// Export JSON

	const exportJson = new UIButton( strings.getKey( 'sidebar/material/export' ) );
	exportJson.setMarginLeft( '120px' );
	exportJson.onClick( function () {

		const object = currentObject || resolveSidebarMeshObject( editor.selected );
		if ( ! object || ! object.material ) return;
		const material = Array.isArray( object.material ) ? object.material[ currentMaterialSlot ] : object.material;

		let output = material.toJSON();

		try {

			output = JSON.stringify( output, null, '\t' );
			output = output.replace( /[\n\t]+([\d\.e\-\[\]]+)/g, '$1' );

		} catch ( error ) {

			output = JSON.stringify( output );

		}

		editor.utils.save( new Blob( [ output ] ), `${ materialName.getValue() || 'material' }.json` );

	} );
	container.add( exportJson );

	//


	function writeShaderFilesIfPossible( material ) {

		const pf = editor.projectFolder;
		if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return;
		if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) return;

		const base = String( material.name || 'CustomShader' )
			.replace( /[<>:"/\\|?*\s]+/g, '_' )
			.replace( /_+/g, '_' )
			.slice( 0, 48 ) || 'CustomShader';
		const vertName = base + '.vert.glsl';
		const fragName = base + '.frag.glsl';

		Promise.resolve()
			.then( function () {

				return pf.saveBlob( 'assets/shaders', vertName, material.vertexShader || '' );

			} )
			.then( function () {

				return pf.saveBlob( 'assets/shaders', fragName, material.fragmentShader || '' );

			} )
			.then( function () {

				if ( ! material.userData ) material.userData = {};
				material.userData.shaderFiles = {
					vert: 'assets/shaders/' + vertName,
					frag: 'assets/shaders/' + fragName
				};

			} )
			.catch( function ( err ) {

				console.warn( '[FreeFilmCut] write shader files failed', err );

			} );

	}

	function assignMaterialToCurrent( material, options = {} ) {

		if ( ! currentObject || currentObject.material === undefined ) return;

		const currentMaterial = currentObject.material;

		if ( Array.isArray( currentMaterial ) ) {

			editor.removeMaterial( currentMaterial[ currentMaterialSlot ] );

		} else {

			editor.removeMaterial( currentMaterial );

		}

		editor.execute(
			new SetMaterialCommand( editor, currentObject, material, currentMaterialSlot ),
			strings.getKey( 'command/SetMaterial' ) + ': ' + material.type
		);
		editor.addMaterial( material );

		writeShaderFilesIfPossible( material );

		materialClass.setValue( material.type );
		editor.selectedMaterialSlot = currentMaterialSlot;
		refreshUI();

		if ( options.openFrag && ( material.isShaderMaterial || material.isRawShaderMaterial ) ) {

			signals.editScript.dispatch( currentObject, 'fragmentShader' );

		}

	}

	function createAndAssignMaterial( type, options = {} ) {

		if ( ! currentObject || currentObject.material === undefined ) return;

		const previous = editor.getObjectMaterial( currentObject, currentMaterialSlot );
		let material;

		if ( type === 'ShaderMaterial' || type === 'RawShaderMaterial' ) {

			material = createFreeFilmCutShaderMaterial( type, previous );

		} else {

			const Cls = materialClasses[ type ] || THREE.MeshStandardMaterial;
			material = new Cls();

			if ( previous ) {

				if ( previous.color && material.color && previous.color.isColor ) {

					material.color.copy( previous.color );

				}

				if ( typeof previous.opacity === 'number' && 'opacity' in material ) {

					material.opacity = previous.opacity;

				}

				if ( 'transparent' in material ) {

					material.transparent = !! previous.transparent;

				}

				if ( previous.map && 'map' in material ) {

					material.map = previous.map;

				}

			}

			material.name = ( type || 'MeshStandardMaterial' ).replace( /Material$/, '' ) || 'Material';

		}

		assignMaterialToCurrent( material, options );

	}

	function cloneAndAssignMaterial() {

		if ( ! currentObject || currentObject.material === undefined ) return;

		const previous = editor.getObjectMaterial( currentObject, currentMaterialSlot );
		if ( ! previous || typeof previous.clone !== 'function' ) return;

		const material = previous.clone();
		material.name = ( previous.name || previous.type || 'Material' ) + '_copy';

		if ( material.isShaderMaterial || material.isRawShaderMaterial ) {

			syncShaderMaterialBridge( material );

		}

		assignMaterialToCurrent( material );

	}

	function update() {


		const previousSelectedSlot = currentMaterialSlot;

		currentMaterialSlot = parseInt( materialSlotSelect.getValue() );

		if ( currentMaterialSlot !== previousSelectedSlot ) {

			editor.signals.materialChanged.dispatch( currentObject, currentMaterialSlot );

		}

		let material = editor.getObjectMaterial( currentObject, currentMaterialSlot );

		if ( material ) {

			if ( material.uuid !== undefined && material.uuid !== materialUUID.getValue() ) {

				editor.execute( new SetMaterialValueCommand( editor, currentObject, 'uuid', materialUUID.getValue(), currentMaterialSlot ) );

			}

			if ( material.type !== materialClass.getValue() ) {

				const nextType = materialClass.getValue();
				const previousMaterial = material;

				if ( nextType === 'ShaderMaterial' || nextType === 'RawShaderMaterial' ) {

					material = createFreeFilmCutShaderMaterial( nextType, previousMaterial );

				} else {

					material = new materialClasses[ nextType ]();

				}

				const currentMaterial = currentObject.material;

				if ( material.type === 'MeshPhysicalMaterial' && currentMaterial.type === 'MeshStandardMaterial' ) {

					// TODO Find a easier to maintain approach

					const properties = [
						'color', 'emissive', 'roughness', 'metalness', 'map', 'emissiveMap', 'alphaMap',
						'bumpMap', 'normalMap', 'normalScale', 'displacementMap', 'roughnessMap', 'metalnessMap',
						'envMap', 'lightMap', 'aoMap', 'side'
					];

					for ( const property of properties ) {

						const value = currentMaterial[ property ];

						if ( value === null ) continue;

						if ( value[ 'clone' ] !== undefined ) {

							material[ property ] = value.clone();

						} else {

							material[ property ] = value;

						}

					}

				}

				if ( Array.isArray( currentMaterial ) ) {

					// don't remove the entire multi-material. just the material of the selected slot

					editor.removeMaterial( currentMaterial[ currentMaterialSlot ] );

				} else {

					editor.removeMaterial( currentMaterial );

				}

				editor.execute( new SetMaterialCommand( editor, currentObject, material, currentMaterialSlot ), strings.getKey( 'command/SetMaterial' ) + ': ' + materialClass.getValue() );
				editor.addMaterial( material );
				// TODO Copy other references in the scene graph
				// keeping name and UUID then.
				// Also there should be means to create a unique
				// copy for the current object explicitly and to
				// attach the current material to other objects.

			}

			try {

				const userData = JSON.parse( materialUserData.getValue() );
				if ( JSON.stringify( material.userData ) != JSON.stringify( userData ) ) {

					editor.execute( new SetMaterialValueCommand( editor, currentObject, 'userData', userData, currentMaterialSlot ) );

				}

			} catch ( exception ) {

				console.warn( exception );

			}

			refreshUI();

		}

	}

	//

	function setRowVisibility() {

		const material = currentObject.material;

		if ( Array.isArray( material ) ) {

			materialSlotRow.setDisplay( '' );

		} else {

			materialSlotRow.setDisplay( 'none' );

		}

	}

	function refreshUI() {

		if ( ! currentObject ) return;

		editor.selectedMaterialSlot = currentMaterialSlot;

		let material = currentObject.material;

		if ( Array.isArray( material ) ) {

			const slotOptions = {};

			currentMaterialSlot = Math.max( 0, Math.min( material.length, currentMaterialSlot ) );

			for ( let i = 0; i < material.length; i ++ ) {

				slotOptions[ i ] = String( i + 1 ) + ': ' + material[ i ].name;

			}

			materialSlotSelect.setOptions( slotOptions ).setValue( currentMaterialSlot );

		}

		material = editor.getObjectMaterial( currentObject, currentMaterialSlot );

		if ( material.uuid !== undefined ) {

			materialUUID.setValue( material.uuid );

		}

		if ( material.name !== undefined ) {

			materialName.setValue( material.name );

		}

		if ( currentObject.isMesh ) {

			materialClass.setOptions( meshMaterialOptions );

		} else if ( currentObject.isSprite ) {

			materialClass.setOptions( spriteMaterialOptions );

		} else if ( currentObject.isPoints ) {

			materialClass.setOptions( pointsMaterialOptions );

		} else if ( currentObject.isLine ) {

			materialClass.setOptions( lineMaterialOptions );

		}

		materialClass.setValue( material.type );

		setRowVisibility();

		try {

			materialUserData.setValue( JSON.stringify( material.userData, null, '  ' ) );

		} catch ( error ) {

			console.log( error );

		}

		materialUserData.setBorderColor( 'transparent' );
		materialUserData.setBackgroundColor( '' );

	}

	// events

	signals.objectSelected.add( function ( object ) {

		// UI Image Group: material lives on child __fccImageMesh (keep Group selected for transforms).
		object = resolveSidebarMeshObject( object );

		let hasMaterial = false;

		if ( object && object.material ) {

			hasMaterial = true;

			if ( Array.isArray( object.material ) && object.material.length === 0 ) {

				hasMaterial = false;

			}

		}

		if ( hasMaterial ) {

			currentObject = object;
			refreshUI();
			container.setDisplay( '' );
			// Property rows (Color/Map/Program/…) listen to objectSelected with the Group
			// (no .material) and hide; re-bind them to the mesh via materialChanged.
			signals.materialChanged.dispatch( currentObject, currentMaterialSlot );

		} else {

			currentObject = null;
			container.setDisplay( 'none' );

		}

	} );

	signals.materialChanged.add( refreshUI );

	return container;

}

const materialClasses = {
	'LineBasicMaterial': THREE.LineBasicMaterial,
	'LineDashedMaterial': THREE.LineDashedMaterial,
	'MeshBasicMaterial': THREE.MeshBasicMaterial,
	'MeshDepthMaterial': THREE.MeshDepthMaterial,
	'MeshNormalMaterial': THREE.MeshNormalMaterial,
	'MeshLambertMaterial': THREE.MeshLambertMaterial,
	'MeshMatcapMaterial': THREE.MeshMatcapMaterial,
	'MeshPhongMaterial': THREE.MeshPhongMaterial,
	'MeshToonMaterial': THREE.MeshToonMaterial,
	'MeshStandardMaterial': THREE.MeshStandardMaterial,
	'MeshPhysicalMaterial': THREE.MeshPhysicalMaterial,
	'RawShaderMaterial': THREE.RawShaderMaterial,
	'ShaderMaterial': THREE.ShaderMaterial,
	'ShadowMaterial': THREE.ShadowMaterial,
	'SpriteMaterial': THREE.SpriteMaterial,
	'PointsMaterial': THREE.PointsMaterial
};

const vertexShaderVariables = [
	'uniform mat4 projectionMatrix;',
	'uniform mat4 modelViewMatrix;\n',
	'attribute vec3 position;\n\n',
].join( '\n' );

const meshMaterialOptions = {
	'MeshBasicMaterial': 'MeshBasicMaterial',
	'MeshDepthMaterial': 'MeshDepthMaterial',
	'MeshNormalMaterial': 'MeshNormalMaterial',
	'MeshLambertMaterial': 'MeshLambertMaterial',
	'MeshMatcapMaterial': 'MeshMatcapMaterial',
	'MeshPhongMaterial': 'MeshPhongMaterial',
	'MeshToonMaterial': 'MeshToonMaterial',
	'MeshStandardMaterial': 'MeshStandardMaterial',
	'MeshPhysicalMaterial': 'MeshPhysicalMaterial',
	'RawShaderMaterial': 'RawShaderMaterial',
	'ShaderMaterial': 'ShaderMaterial',
	'ShadowMaterial': 'ShadowMaterial'
};

const lineMaterialOptions = {
	'LineBasicMaterial': 'LineBasicMaterial',
	'LineDashedMaterial': 'LineDashedMaterial',
	'RawShaderMaterial': 'RawShaderMaterial',
	'ShaderMaterial': 'ShaderMaterial'
};

const spriteMaterialOptions = {
	'SpriteMaterial': 'SpriteMaterial',
	'RawShaderMaterial': 'RawShaderMaterial',
	'ShaderMaterial': 'ShaderMaterial'
};

const pointsMaterialOptions = {
	'PointsMaterial': 'PointsMaterial',
	'RawShaderMaterial': 'RawShaderMaterial',
	'ShaderMaterial': 'ShaderMaterial'
};

export { SidebarMaterial };
