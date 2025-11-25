import{c as o,u as l,a as r,j as e,S as d}from "./index-BqfF2MFw.js";import{I as t,a}from "./InfoBlock-BSFsGexk.js";import{U as u}from "./user-DcrN8dRf.js";/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x=[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]],m=o("calendar",x);/**
 * @license lucide-react v0.546.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]],y=o("hash",h),b=()=>{const{user:s,logout:n}=l(),c=r(),i=async()=>{await n(),c("/login")};return e.jsx("div",{className:"min-h-screen bg-background",children:e.jsxs("div",{className:"container mx-auto px-4 py-8",children:[e.jsx("div",{className:"mb-8",children:e.jsx("h1",{className:"font-display text-3xl font-semibold text-foreground mb-2",children:"About Me"})}),e.jsxs("div",{className:"grid gap-6 md:grid-cols-2 lg:grid-cols-3",children:[e.jsxs(t,{title:"Account Information",className:"lg:col-span-2",children:[e.jsx(a,{label:"Username",value:s?.username,icon:u}),e.jsx(a,{label:"User ID",value:s?.id,icon:y}),e.jsx(a,{label:"Role",value:s?.role,icon:d}),e.jsx(a,{label:"Member Since",value:s?.created_at?new Date(s.created_at).toLocaleDateString():"N/A",icon:m})]}),e.jsx(t,{title:"Quick Actions",children:e.jsx("div",{className:"space-y-3",children:e.jsx("button",{onClick:i,className:"w-full px-4 py-2 bg-destructive text-destructive-foreground rounded-md hover:bg-destructive/90 transition-colors font-medium",children:"Sign Out"})})})]})]})})};export{b as default};
