import { Command } from '../Command.js';
import * as THREE from 'three';

/**
 * Set one ShaderMaterial uniform value (color hex / number / boolean).
 */
class SetMaterialUniformCommand extends Command {

	/**
	 * @param {Editor} editor
	 * @param {THREE.Object3D|null} [object=null]
	 * @param {string} [uniformName='']
	 * @param {number|boolean|null} [newValue=null] hex for color, number, or boolean
	 * @param {number} [materialSlot=-1]
	 * @param {'color'|'number'|'boolean'} [valueKind='number']
	 */
	constructor( editor, object = null, uniformName = '', newValue = null, materialSlot = - 1, valueKind = 'number' ) {

		super( editor );

		this.type = 'SetMaterialUniformCommand';
		this.name = 'Set Material Uniform: ' + uniformName;
		this.updatable = true;

		this.object = object;
		this.materialSlot = materialSlot;
		this.uniformName = uniformName;
		this.valueKind = valueKind;
		this.newValue = newValue;

		const material = ( object !== null ) ? editor.getObjectMaterial( object, materialSlot ) : null;
		this.oldValue = null;

		if ( material && material.uniforms && material.uniforms[ uniformName ] ) {

			const v = material.uniforms[ uniformName ].value;

			if ( valueKind === 'color' ) {

				if ( v && v.isColor ) this.oldValue = v.getHex();
				else if ( v && v.isVector3 ) this.oldValue = new THREE.Color( v.x, v.y, v.z ).getHex();
				else this.oldValue = 0xffffff;

			} else {

				this.oldValue = v;

			}

		}

	}

	_apply( value ) {

		const material = this.editor.getObjectMaterial( this.object, this.materialSlot );
		if ( ! material.uniforms ) material.uniforms = {};

		if ( ! material.uniforms[ this.uniformName ] ) {

			material.uniforms[ this.uniformName ] = { value: null };

		}

		const entry = material.uniforms[ this.uniformName ];

		if ( this.valueKind === 'color' ) {

			if ( entry.value && entry.value.isColor ) {

				entry.value.setHex( value );

			} else if ( entry.value && entry.value.isVector3 ) {

				const c = new THREE.Color( value );
				entry.value.set( c.r, c.g, c.b );

			} else {

				entry.value = new THREE.Color( value );

			}

			// Keep sidebar bridge in sync when editing built-in color uniform
			if ( this.uniformName === 'color' && material.color && material.color.isColor ) {

				material.color.setHex( value );

			}

		} else {

			entry.value = value;

			if ( this.uniformName === 'opacity' && typeof value === 'number' ) {

				material.opacity = value;

			}

		}

		material.needsUpdate = true;
		this.editor.signals.materialChanged.dispatch( this.object, this.materialSlot );

	}

	execute() {

		this._apply( this.newValue );

	}

	undo() {

		this._apply( this.oldValue );

	}

	update( cmd ) {

		this.newValue = cmd.newValue;

	}

	toJSON() {

		const output = super.toJSON( this );
		output.objectUuid = this.object.uuid;
		output.uniformName = this.uniformName;
		output.oldValue = this.oldValue;
		output.newValue = this.newValue;
		output.materialSlot = this.materialSlot;
		output.valueKind = this.valueKind;
		return output;

	}

	fromJSON( json ) {

		super.fromJSON( json );
		this.object = this.editor.objectByUuid( json.objectUuid );
		this.uniformName = json.uniformName;
		this.oldValue = json.oldValue;
		this.newValue = json.newValue;
		this.materialSlot = json.materialSlot;
		this.valueKind = json.valueKind || 'number';

	}

}

export { SetMaterialUniformCommand };
