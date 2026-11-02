import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,vi,expect} from 'vitest';
const mock=vi.hoisted(()=>({receipt:vi.fn()}));
vi.mock('../api',()=>({getServerUrl:()=> 'http://127.0.0.1:57892'}));
vi.mock('../mobileLocalMode',()=>({isAndroidNativeRuntime:()=>false}));
vi.mock('../syncLocalApi',()=>({fetchNoteSyncReceipt:mock.receipt}));
vi.mock('../offlineQueue',()=>({getQueue:()=>[],subscribe:()=>()=>{}}));
vi.mock('../noteSyncSafety',()=>({getNoteSyncConflict:()=>null}));
import {useNoteSyncReceipt} from '../useNoteSyncReceipt';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let root:Root,host:HTMLElement;
function Receipt(){return <span>{useNoteSyncReceipt('note',true)}</span>;}
beforeEach(()=>{vi.useFakeTimers();Object.assign(window,{nowenDesktop:{isDesktop:true}});host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();Reflect.deleteProperty(window,'nowenDesktop');vi.useRealTimers();});
it('Electron waits for its exact backend body receipt instead of using local REST success',async()=>{
 mock.receipt.mockResolvedValue({phase:'pending'});await act(async()=>root.render(<Receipt/>));expect(host.textContent).toBe('pending');
 mock.receipt.mockResolvedValue({phase:'confirmed'});await act(async()=>vi.advanceTimersByTime(1000));expect(host.textContent).toBe('confirmed');
 mock.receipt.mockRejectedValue(new Error('offline'));await act(async()=>vi.advanceTimersByTime(1000));expect(host.textContent).toBe('unverified');
});
