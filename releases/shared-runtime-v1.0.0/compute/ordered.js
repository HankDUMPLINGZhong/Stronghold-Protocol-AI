// Ordered common-sample execution, complete-result caching and bounded prefetch. No candidate or score rules.
import { stepForecastBattle } from './forecast.js';
export function createOrderedForecastJob({ match:m, player:ps, session:s, plans, samples, inputs, entries, shared,
  stamp, hp, cap, key, expired, makeSpec, field, makePool, select, cannotBeat, project, validWorkerRow,
  projection = 'boss-damage', label = 'forecast' }) {
  let index=0,sample=0,trial=null;
  const pending=new Map(),blocked=new Set();
  const cancelPending=()=>{for(const task of pending.values())task.cancel();pending.clear();};
  const prefetch=()=>{
    if(!s.worker||s.worker.closed||s.worker.pool.closed)return;
    for(let j=sample;j<Math.min(samples,sample+2);j++){
      const key=`${index}:${j}`;
      if(entries[index].has(j)||shared[index]?.has(j)||pending.has(key)||blocked.has(key))continue;
      try{
        const {sharedBoss,...spec}=makeSpec(inputs[index],j);void sharedBoss;
        const deadline=s.m.sched.virtual?null:performance.timeOrigin+s.started+s.limits.wallMs;
        const task=s.worker.pool.submit(s.worker.owner,{spec,hp,playerId:ps.playerId,cap,deadline,projection});
        if(task){pending.set(key,task);s.worker.submitted++;}else blocked.add(key);
      }catch{blocked.add(key);s.worker.fallback++;}
    }
  };
  const job={done:false,best:plans[0],bestIndex:0,outcomes:[],plans,stale:false,pruned:[],
    run(budgetMs=Infinity){
      if(job.done)return true;const started=performance.now();
      const finish=()=>{
        job.stale=key()!==stamp;if(job.stale)s.reason='own-state-changed';
        if(!job.stale)job.bestIndex=select(job.outcomes);
        job.best=plans[job.bestIndex];job.done=true;
        trial?.battle?.dispose?.();trial=null;cancelPending();if(s.worker)ps._botCoopWorkerWaiting=false;return true;
      };
      if(key()!==stamp||expired())return finish();
      while(index<plans.length){
        prefetch();
        if(entries[index].has(sample)){job.outcomes.push({...entries[index].get(sample),index,sample});s.hits++;sample++;}
        else if(shared[index]?.has(sample)){
          const saved=shared[index].get(sample),remaining=s.limits.fieldSteps-s.steps;
          // Legacy stepping expires before recording the sample when its final tick reaches the ceiling.
          const charge=Math.min(saved.ticks,remaining);s.steps+=charge;s.savedSteps+=charge;
          s.perf.savedFieldSteps+=charge;
          if(expired())return finish();
          job.outcomes.push({...saved.row,index,sample});entries[index].set(sample,{...saved.row});
          s.reused++;s.simulated++;s.perf.sharedHits++;sample++;
        }else{
          if(expired())return finish();
          let remote=false;
          const taskKey=`${index}:${sample}`,task=!trial&&pending.get(taskKey);
          if(task){
            const result=task.poll(s.m.sched.virtual);
            if(!result){ps._botCoopWorkerWaiting=true;return false;}
            ps._botCoopWorkerWaiting=false;
            pending.delete(taskKey);
            if(result.row?.valid&&Number.isInteger(result.ticks)&&result.ticks>=0&&result.ticks<=cap
              &&validWorkerRow(result.row)){
              s.steps+=Math.min(result.ticks,s.limits.fieldSteps-s.steps);
              s.worker.consumed++;s.worker.ticks+=result.ticks;
              if(expired())return finish();
              const row={...result.row,index,sample};job.outcomes.push(row);entries[index].set(sample,{...row});
              shared[index]?.set(sample,{row:{...row},ticks:result.ticks});
              sample++;s.simulated++;remote=true;
            }else{blocked.add(taskKey);s.worker.fallback++;}
          }
          if(!remote){
            if(!trial){
              trial={pool:makePool(),battle:null,ticks:0};
              try{trial.battle=field(inputs[index],trial.pool,sample);}
              catch(e){m.log.warn?.(`${label} forecast construction failed: ${e.message}`);job.outcomes.push({index,sample,valid:false});
                trial=null;sample++;if(sample===samples){index++;sample=0;}continue;}
            }
            try{
              while(!trial.battle.finished&&trial.ticks<cap){
                stepForecastBattle(trial.battle);trial.ticks++;s.steps++;
                if(expired())return finish();
                if(trial.ticks%4===0&&performance.now()-started>=budgetMs)return false;
              }
              if(!trial.battle.finished)trial.battle.forceEnd('timeout');
              const row={index,sample,...project(trial.battle,trial.pool)},valid=row.valid;
              job.outcomes.push(row);if(valid){entries[index].set(sample,{...row});
                shared[index]?.set(sample,{row:{...row},ticks:trial.ticks});}
            }catch(e){job.outcomes.push({index,sample,valid:false});m.log.warn?.(`${label} forecast failed: ${e.message}`);}
            trial.battle.dispose?.();trial=null;sample++;s.simulated++;
          }
        }
        if(index>0&&sample<samples){
          const incumbent=select(job.outcomes);
          if(cannotBeat(job.outcomes.filter(r=>r.index===index),job.outcomes.filter(r=>r.index===incumbent))){
            job.pruned.push(index);s.pruned++;cancelPending();index++;sample=0;
          }
        }
        if(sample===samples){index++;sample=0;}
        if(performance.now()-started>=budgetMs)return false;
      }
      return finish();
    },cancel(){cancelPending();trial?.battle?.dispose?.();trial=null;job.done=true;if(s.worker)ps._botCoopWorkerWaiting=false;}};
  s.comparisons++;s.activeJob=job;return job;
}
