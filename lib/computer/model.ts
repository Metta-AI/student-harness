import {z} from 'zod';
import {browserOrigin} from '../browser/model';
export const desktopCreate=z.object({requestKey:z.uuid(),access:z.literal('isolated-desktop'),origins:z.array(browserOrigin).max(12).transform(v=>[...new Set(v)].sort())}).strict();
const op={id:z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/),epoch:z.number().int().positive()};
const viewed={...op,view:z.number().int().nonnegative()};
const point={x:z.number().int().min(0).max(1279),y:z.number().int().min(0).max(719)};
export const desktopKeys=['Return','Tab','shift+Tab','Escape','BackSpace','Delete','Left','Right','Up','Down','space','Home','End','Page_Up','Page_Down','ctrl+a','ctrl+c','ctrl+v','ctrl+x','ctrl+z','ctrl+y','ctrl+s','ctrl+o','ctrl+w','ctrl+l','ctrl+shift+c','ctrl+shift+v','alt+Tab','alt+F4','F5'] as const;
export const desktopCommand=z.discriminatedUnion('action',[
 z.object({...op,action:z.literal('observe')}).strict(),
 z.object({...viewed,...point,action:z.literal('click'),button:z.union([z.literal(1),z.literal(2),z.literal(3)]).optional()}).strict(),
 z.object({...viewed,action:z.literal('type'),text:z.string().min(1).max(1000).regex(/^[^\x00-\x08\x0b-\x1f\x7f]+$/)}).strict(),
 z.object({...viewed,action:z.literal('key'),key:z.enum(desktopKeys)}).strict(),
 z.object({...viewed,...point,action:z.literal('scroll'),direction:z.enum(['up','down','left','right']),steps:z.number().int().min(1).max(20)}).strict(),
 z.object({...viewed,...point,action:z.literal('drag'),toX:point.x,toY:point.y}).strict(),
]);
export const desktopMutation=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),input:desktopCreate}).strict(),
 z.object({action:z.literal('stop'),id:z.uuid()}).strict(),
 z.object({action:z.literal('command'),id:z.uuid(),command:desktopCommand}).strict(),
 z.object({action:z.literal('handoff'),id:z.uuid(),epoch:op.epoch,owner:z.enum(['human','agent'])}).strict(),
 z.object({action:z.literal('inspect'),id:z.uuid()}).strict(),
 z.object({action:z.literal('receipt'),id:z.uuid(),operationId:op.id}).strict(),
]);
