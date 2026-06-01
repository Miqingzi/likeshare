import fs from 'fs';
fetch('https://raw.githubusercontent.com/copyangle/SS_tools/main/duck_encode_node.py')
  .then(res => res.text())
  .then(text => fs.writeFileSync('duck_encode_node.py', text))
  .catch(err => console.error(err));
fetch('https://raw.githubusercontent.com/copyangle/SS_tools/main/duck_decode_node.py')
  .then(res => res.text())
  .then(text => fs.writeFileSync('duck_decode_node.py', text))
  .catch(err => console.error(err));
