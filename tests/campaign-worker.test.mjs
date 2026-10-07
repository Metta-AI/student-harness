import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
test('native worker authenticates, preserves jobs and pins engine bytes (fake executables only)',()=>{
 execFileSync('python3',['tests/python/replay_audit_test.py'],{cwd:process.cwd(),stdio:'pipe',timeout:15000});
});
