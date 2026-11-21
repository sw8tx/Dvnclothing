"""Build the five approximate on-body GLBs from the documented SAM person mesh.
Run: blender -b --python scripts/models/build-worn.py -- /path/person-source.glb
The generated person's texture stays on skin, hair and trousers. Only garment
faces receive original product-photo UVs. No portrait is wrapped around a mesh.
"""
import bpy,bmesh,sys,os
from pathlib import Path
from mathutils import Vector
root=Path(__file__).resolve().parents[2]
source=sys.argv[sys.argv.index('--')+1]
bounds={
 'blue-sunshine':[(60,565,805),(130,390,980),(285,85,1300),(505,190,1185),(525,335,1050),(1055,335,1050)],
 'purple-sunshine':[(35,550,800),(130,355,1045),(400,40,1360),(595,240,1170),(630,300,1110),(1075,300,1110)],
 'blue-mirage-black':[(70,615,785),(110,510,900),(200,355,1050),(420,100,1265),(450,100,1265),(625,300,1100),(650,330,1090),(1060,330,1090)],
 'blue-mirage-white':[(65,605,785),(125,400,955),(200,290,1080),(420,100,1280),(600,295,1100),(620,310,1080),(1060,310,1080)],
 'define-your-vision':[(130,345,480),(175,220,620),(280,55,790),(395,130,720),(420,195,645),(710,195,645)],
 'define-your-vision-back':[(55,345,510),(110,260,590),(160,210,650),(395,120,720),(430,175,700),(460,230,635),(760,235,625),(773,275,590)]
}
def clamp_texture(px,py,key):
 points=bounds[key];py=max(points[0][0],min(points[-1][0],py));left,right=points[-1][1:]
 for a,b in zip(points,points[1:]):
  if a[0]<=py<=b[0]:
   ratio=(py-a[0])/(b[0]-a[0]);left=a[1]+ratio*(b[1]-a[1]);right=a[2]+ratio*(b[2]-a[2]);break
 return max(left+4,min(right-4,px)),py

variants=[('blue-mirage-black',(70,65,1301,1088),(.018,.018,.018)),('blue-mirage-white',(51,67,1327,1086),(.8,.8,.8)),('define-your-vision',(25,124,807,744),(.085,.085,.085)),('blue-sunshine',(65,45,1320,1065),(.018,.018,.018)),('purple-sunshine',(35,32,1362,1095),(.8,.8,.8))]
for name,box,base in variants:
 if os.environ.get('DVN_ONLY') and name!=os.environ['DVN_ONLY']: continue
 bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
 bpy.ops.import_scene.gltf(filepath=source)
 obj=next(o for o in bpy.context.scene.objects if o.type=='MESH');bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 # Cut an exact hem before material assignment, avoiding jagged polygon edges.
 bm=bmesh.new();bm.from_mesh(obj.data)
 for height in [-.095,.36]:
  bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,height),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
 edges=[e for e in bm.edges if any((v.co.z>.27 or (.02<v.co.z<.18 and abs(v.co.x)>.105)) for v in e.verts)]
 bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
 bm.to_mesh(obj.data);bm.free();obj.data.update()
 obj.name='DVN-person-wearing-'+name
 obj['visualisation']='Approximate AI person and fit; original product photos are authoritative.'
 original=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
 pixels=list(original.pixels);iw,ih=original.size
 uv=obj.data.uv_layers.active
 def skin(poly):
  colors=[]
  for li in poly.loop_indices:
   u,v=uv.data[li].uv;offset=(min(ih-1,max(0,int(v*ih)))*iw+min(iw-1,max(0,int(u*iw))))*4
   colors.append(pixels[offset:offset+3])
  r,g,b=[sum(c[i] for c in colors)/len(colors) for i in range(3)]
  return r>.12 and r>g*1.16 and r>b*1.28
 shirt=[]
 for p in obj.data.polygons:
  x,y,z=p.center
  if -.095<z<.36 and not (skin(p) and (abs(x)>.105 or z>.285)):
   shirt.append(p.index)
 front=bpy.data.materials.new(name+'-original-front');front.use_nodes=True
 bs=front.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.95
 im=bpy.data.images.load(str(root/'assets/products'/f'{name}.jpg'));tex=front.node_tree.nodes.new('ShaderNodeTexImage');tex.image=im;tex.extension='EXTEND';front.node_tree.links.new(tex.outputs['Color'],bs.inputs['Base Color']);obj.data.materials.append(front)
 back=bpy.data.materials.new(name+'-back');back.use_nodes=True;bs=back.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*base,1);bs.inputs['Roughness'].default_value=.95;obj.data.materials.append(back)
 if name=='define-your-vision':
  bim=bpy.data.images.load(str(root/'assets/products/define-your-vision-back.jpg'));bt=back.node_tree.nodes.new('ShaderNodeTexImage');bt.image=bim;bt.extension='EXTEND';back.node_tree.links.new(bt.outputs['Color'],bs.inputs['Base Color'])
 fabric=bpy.data.materials.new(name+'-edge-fabric');fabric.use_nodes=True;fbs=fabric.node_tree.nodes.get('Principled BSDF');fbs.inputs['Base Color'].default_value=(*base,1);fbs.inputs['Roughness'].default_value=.95;obj.data.materials.append(fabric)
 photo_pixels=list(im.pixels)
 for pi in shirt:
  p=obj.data.polygons[pi];isfront=p.normal.y<-.12 and not (abs(p.center.x)<.055 and p.center.z>.285)
  edge=p.normal.y<-.12 and name in ['blue-sunshine','define-your-vision'] and (abs(p.center.x)>.12 or p.center.z>.29)
  p.material_index=3 if edge else 1 if isfront else 2
  for li in p.loop_indices:
   v=obj.data.vertices[obj.data.loops[li].vertex_index].co
   x=(v.x+.225)/.45;z=(v.z+.105)/.45
   if name=='define-your-vision' and not isfront: x=1-x;bb=(100,46,737,790);w,h=bim.size;key=name+'-back'
   else: bb=box;w,h=im.size;key=name
   px,py=clamp_texture(bb[0]+x*(bb[2]-bb[0]),bb[3]-z*(bb[3]-bb[1]),key)
   # Reject white photo background along dark sleeve silhouettes.
   if isfront and name in ['blue-sunshine','define-your-vision'] and abs(v.x)>.12:
    for attempt in range(20):
     offset=(min(h-1,max(0,int(h-1-py)))*w+min(w-1,max(0,int(px))))*4
     if max(photo_pixels[offset:offset+3])<.55: break
     px+=(w/2-px)*.025
   uv.data[li].uv=(px/w,1-py/h)
 # SAM uses unit-height bounds. Make the illustrative figure 1.8m tall.
 obj.scale=(1.8,)*3;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bpy.ops.export_scene.gltf(filepath=str(root/'assets/models'/f'{name}.glb'),export_format='GLB',use_selection=True,export_animations=False,export_cameras=False,export_lights=False,export_image_format='JPEG',export_jpeg_quality=90)
 if os.environ.get('DVN_RENDER_DIR'):
  s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=False;s.render.resolution_x=600;s.render.resolution_y=800;s.render.resolution_percentage=100;s.world.use_nodes=True;s.world.node_tree.nodes.get('Background').inputs[0].default_value=(.8,.8,.8,1);s.view_settings.view_transform='Standard'
  bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=2.05
  for label,pos in [('front',(0,-3.6,0)),('side',(2.7,-2.7,0)),('back',(0,3.6,0))]:
   cam.location=Vector(pos);cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();s.render.filepath=os.environ['DVN_RENDER_DIR']+'/'+name+'-'+label+'.png';bpy.ops.render.render(write_still=True)
 print('DONE',name,len(shirt),'garment faces',flush=True)
