// Optional, explicitly authored alternatives. No inference or generated wording.
export function preparedAngleFields(value) {
 if(value===undefined)return {};
 if(value===null||typeof value!=='object'||Array.isArray(value))throw new TypeError('preparedAngles must be an object with optional story and tips text');
 const angles={};
 for(const [key,text] of Object.entries(value)) {
  if(!['story','tips'].includes(key)||typeof text!=='string'||!text.trim()||text.length>500)throw new TypeError('preparedAngles accepts only non-empty story and tips text, at most 500 characters each');
  angles[key]=text;
 }
 return Object.keys(angles).length?{preparedAngles:angles}:{};
}
