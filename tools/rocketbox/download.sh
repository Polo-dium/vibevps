#!/usr/bin/env bash
# Télécharge les avatars Rocketbox (FBX + textures réduites à 512 px, PNG) dans
# client/public/_pv/rb (dossier de travail, NON versionné). Usage :
#   ROOT=$(pwd) bash tools/rocketbox/download.sh   (liste des avatars dans la boucle)

set -e
for path in Adults/Male_Adult_08; do
  n=${path##*/}; mkdir -p $ROOT/client/public/_pv/rb/$n/Export $ROOT/client/public/_pv/rb/$n/Textures
  [ -s $ROOT/client/public/_pv/rb/$n/Export/$n.fbx ] || curl -sf -m 120 -o $ROOT/client/public/_pv/rb/$n/Export/$n.fbx https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/$path/Export/$n.fbx
  for t in $(strings $ROOT/client/public/_pv/rb/$n/Export/$n.fbx | grep -ioE "[a-z0-9_]+_(body_color|head_color|opacity_color)\.tga" | sort -u); do
    b=${t%.tga}
    [ -s $ROOT/client/public/_pv/rb/$n/Textures/$b.png ] && continue
    curl -sf -m 180 -o /tmp/rocketbox.tga https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/$path/Textures/$t
    python3 -c "
from PIL import Image
im=Image.open('/tmp/rocketbox.tga')
if 'opacity' in '$b':
  im.convert('RGBA').resize((512,512),Image.LANCZOS).save('$ROOT/client/public/_pv/rb/$n/Textures/$b.png',optimize=True)
else:
  im.convert('RGB').resize((512,512),Image.LANCZOS).save('$ROOT/client/public/_pv/rb/$n/Textures/$b.png',optimize=True)
"
  done
  echo "$n ok $(ls $ROOT/client/public/_pv/rb/$n/Textures | wc -l)"
done
rm -f /tmp/rocketbox.tga $ROOT/client/public/_pv/rb/*/Textures/*.tga
