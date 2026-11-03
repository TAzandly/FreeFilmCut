from pathlib import Path

engine = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\textanim\TextAnimEngine.js")
text = engine.read_text(encoding="utf-8")

# Add resolveFarParams helper before passOpsFor if missing
helper = r'''
/**
 * Far pose for charIn (start) / charOut (end): sample param keys at progress
 * 0 or 1, or the first/last key on each track. Never use the live global
 * interpolated values — those caused rigid whole-text motion when multiplied
 * by per-char weight.
 */
function resolveFarParams( comp, desc, values, trackKeys, atEnd ) {

	if ( ! desc ) return comp && comp.params ? comp.params : {};
	const id = comp.id;
	const localValues = new Map();
	if ( values ) {

		for ( const [ k, v ] of values ) {

			if ( k === id + '.enabled' || k.indexOf( id + '.selector.' ) === 0 ) localValues.set( k, v );

		}

	}

	const targetP = atEnd ? 1 : 0;
	if ( trackKeys && trackKeys.size ) {

		const progKeys = trackKeys.get( id + '.progress' );
		if ( progKeys && progKeys.length ) {

			const remapped = resolveParamsAtLocalProgress( comp, desc, localValues, trackKeys, targetP );
			if ( remapped ) return remapped.params;

		}

		const schema = desc.params || {};
		for ( const key of Object.keys( schema ) ) {

			const pk = trackKeys.get( id + '.' + key );
			if ( pk && pk.length ) {

				localValues.set( id + '.' + key, atEnd ? pk[ pk.length - 1 ].v : pk[ 0 ].v );
				continue;

			}
			const pk0 = trackKeys.get( id + '.' + key + '.0' );
			if ( pk0 && pk0.length ) {

				localValues.set( id + '.' + key + '.0', atEnd ? pk0[ pk0.length - 1 ].v : pk0[ 0 ].v );

			}

		}

	}

	return resolveComponent( comp, desc, localValues ).params;

}

'''

if 'function resolveFarParams(' not in text:
    marker = 'function passOpsFor( comps, time, values ) {'
    if marker not in text:
        raise SystemExit('passOpsFor marker missing')
    text = text.replace(marker, helper + marker, 1)

old_loop = '''\t\tconst amount = sel ? ( sel.amount != null ? sel.amount : 1 ) : 1;
\t\t// charIn/charOut: same keyed curve, delayed per char (CapCut-style).
\t\tconst mapParams = !! desc.progressMappedParams || desc.type === 'charIn' || desc.type === 'charOut';
\t\tconst ctx = {
\t\t\tt: time,
\t\t\traw: 0,
\t\t\tp: 0,
\t\t\tprogress: r.progress,
\t\t\tamount,
\t\t\tparams: r.params,
\t\t\tparamsMapped: false,
\t\t\ton: comp.channels || {},
\t\t\tcomp,
\t\t\tcharIndex: 0,
\t\t\tcharCount: n,
\t\t};

\t\tfor ( let i = 0; i < n; i ++ ) {

\t\t\tconst weight = sel
\t\t\t\t? charWeight( r.progress, ranks[ i ], n, sel )
\t\t\t\t: { raw: r.progress, p: r.progress };

\t\t\t// Out-of-range chars never touch the pose (AE Range Selector).
\t\t\tif ( weight.skip ) continue;

\t\t\tctx.charIndex = i;
\t\t\tctx.raw = weight.raw;
\t\t\tctx.params = r.params;
\t\t\tctx.paramsMapped = false;
\t\t\tctx.p = weight.p;

\t\t\tif ( mapParams && trackKeys ) {

\t\t\t\t// Position on the shared property curve = eased local raw (amount
\t\t\t\t// blends toward rest inside sample, not into the time remap).
\t\t\t\tconst localP = sel
\t\t\t\t\t? easeSample( sel.ease, weight.raw )
\t\t\t\t\t: weight.raw;
\t\t\t\tconst remapped = resolveParamsAtLocalProgress( comp, desc, values, trackKeys, localP );
\t\t\t\tif ( remapped ) {

\t\t\t\t\tctx.params = remapped.params;
\t\t\t\t\tctx.paramsMapped = true;
\t\t\t\t\tctx.p = amount;
\t\t\t\t\tctx.progress = localP;

\t\t\t\t}

\t\t\t}

\t\t\tdesc.sample( ctx, poses[ i ] );

\t\t}'''

new_loop = '''\t\tconst amount = sel ? ( sel.amount != null ? sel.amount : 1 ) : 1;
\t\t// charIn/charOut: CapCut stagger = far amplitude (keys at progress 0/1)
\t\t// times per-char weight. Do NOT sample live global param values here —
\t\t// that made every glyph share one Y and look like rigid vertical motion.
\t\t// Do NOT set paramsMapped+p=amount either: with rest defaults or a stale
\t\t// builtins build that ignores paramsMapped, that path zeros all motion.
\t\tconst staggerFar = !! desc.progressMappedParams || desc.type === 'charIn' || desc.type === 'charOut';
\t\tconst farParams = staggerFar
\t\t\t? resolveFarParams( comp, desc, values, trackKeys, desc.type === 'charOut' || desc.category === 'out' )
\t\t\t: r.params;
\t\tconst ctx = {
\t\t\tt: time,
\t\t\traw: 0,
\t\t\tp: 0,
\t\t\tprogress: r.progress,
\t\t\tamount,
\t\t\tparams: farParams,
\t\t\tparamsMapped: false,
\t\t\ton: comp.channels || {},
\t\t\tcomp,
\t\t\tcharIndex: 0,
\t\t\tcharCount: n,
\t\t};

\t\tfor ( let i = 0; i < n; i ++ ) {

\t\t\tconst weight = sel
\t\t\t\t? charWeight( r.progress, ranks[ i ], n, sel )
\t\t\t\t: { raw: r.progress, p: r.progress };

\t\t\t// Out-of-range chars never touch the pose (AE Range Selector).
\t\t\tif ( weight.skip ) continue;

\t\t\tctx.charIndex = i;
\t\t\tctx.raw = weight.raw;
\t\t\tctx.params = staggerFar ? farParams : r.params;
\t\t\tctx.paramsMapped = false;
\t\t\tctx.p = weight.p;
\t\t\tctx.progress = r.progress;

\t\t\tdesc.sample( ctx, poses[ i ] );

\t\t}'''

if old_loop not in text:
    raise SystemExit('old loop not found exactly')
text = text.replace(old_loop, new_loop, 1)

text = text.replace("TextAnimTypes.js?v=fcc-tanim-21", "TextAnimTypes.js?v=fcc-tanim-22")

engine.write_text(text, encoding='utf-8')
print('engine OK', 'resolveFarParams' in text, 'staggerFar' in text, 'ctx.p = amount' in text)
