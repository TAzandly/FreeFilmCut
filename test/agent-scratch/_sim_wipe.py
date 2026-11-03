from pathlib import Path
# quick mental: also check if sampleKeys with ease matters

# Reproduce: authored=1, play=2, wall from 0..2
def remap(wall, play, authored):
    return wall * (authored / play)

def sample_keys(keys, t):
    if t <= keys[0][0]: return keys[0][1]
    if t >= keys[-1][0]: return keys[-1][1]
    for i in range(len(keys)-1):
        a,b = keys[i], keys[i+1]
        if a[0] <= t <= b[0]:
            u = (t-a[0])/(b[0]-a[0]) if b[0]!=a[0] else 0
            return a[1]+(b[1]-a[1])*u
    return keys[-1][1]

keys=[(0,0),(1,1)]
for wall in [0, 0.5, 1.0, 1.5, 2.0]:
    t=remap(wall,2,1)
    print(f'wall={wall} authored_t={t} progress={sample_keys(keys,t)}')
