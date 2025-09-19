import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage, Layer, Rect, Text, Group, Line, Circle, Ellipse } from 'react-konva';
import Konva from 'konva';

// --- TYPE DEFINITIONS ---

type EntityType = 'Entity' | 'Action' | 'Attribute';
type Cardinality = 'ONE_AND_ONLY_ONE' | 'ZERO_OR_ONE' | 'ONE_OR_MANY' | 'ZERO_OR_MANY' | 'ONE' | 'MANY';
const CARDINALITIES: Cardinality[] = ['ONE_AND_ONLY_ONE', 'ZERO_OR_ONE', 'ONE_OR_MANY', 'ZERO_OR_MANY', 'ONE', 'MANY'];

interface Entity { id: string; x: number; y: number; width: number; height: number; name: string; type: EntityType; }
interface Relationship { id: string; fromId: string; toId: string; startCardinality: Cardinality; endCardinality: Cardinality; }
interface EntityComponentProps { entity: Entity; isSelected: boolean; onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void; onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void; onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void; onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => void; }
const ENTITY_STYLES: { [key in EntityType]: { fill: string; stroke: string; textColor: string } } = { Entity: { fill: '#1abc9c', stroke: '#16a085', textColor: '#ffffff' }, Action: { fill: '#3498db', stroke: '#2980b9', textColor: '#ffffff' }, Attribute: { fill: '#e74c3c', stroke: '#c0392b', textColor: '#ffffff' }, };

interface ErdViewProps {
  entities: Entity[];
  relationships: Relationship[];
  onStateChange: (entitiesUpdater: any, relationshipsUpdater: any) => void;
  selectedEntityId: string | null;
  setSelectedEntityId: React.Dispatch<React.SetStateAction<string | null>>;
  selectedRelationshipId: string | null;
  setSelectedRelationshipId: React.Dispatch<React.SetStateAction<string | null>>;
  relationshipCreation: { active: boolean; fromId: string | null };
  setRelationshipCreation: React.Dispatch<React.SetStateAction<{ active: boolean; fromId: string | null }>>;
  editingEntityId: string | null;
  setEditingEntityId: React.Dispatch<React.SetStateAction<string | null>>;
  showCardinality: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
}

// --- HELPERS ---
const calculateRelationshipRenderProps = (fromEntity: Entity, toEntity: Entity) => {
    const getAnchors = (e: Entity) => [
        { x: e.x + e.width / 2, y: e.y }, 
        { x: e.x + e.width, y: e.y + e.height / 2 }, 
        { x: e.x + e.width / 2, y: e.y + e.height }, 
        { x: e.x, y: e.y + e.height / 2 },
    ];

    const fromAnchors = getAnchors(fromEntity);
    const toAnchors = getAnchors(toEntity);
    let minDistance = Infinity;
    let bestPoints = { from: fromAnchors[0], to: toAnchors[0] };

    for (const fromPoint of fromAnchors) {
        for (const toPoint of toAnchors) {
            const distance = Math.hypot(fromPoint.x - toPoint.x, fromPoint.y - toPoint.y);
            if (distance < minDistance) {
                minDistance = distance;
                bestPoints = { from: fromPoint, to: toPoint };
            }
        }
    }

    const points = [bestPoints.from.x, bestPoints.from.y, bestPoints.to.x, bestPoints.to.y];
    const angleRad = Math.atan2(bestPoints.to.y - bestPoints.from.y, bestPoints.to.x - bestPoints.from.x);
    const angleDeg = angleRad * (180 / Math.PI);
    const offset = 20;

    const startSymbolProps = {
        x: bestPoints.from.x + offset * Math.cos(angleRad),
        y: bestPoints.from.y + offset * Math.sin(angleRad),
        rotation: angleDeg + 180,
    };

    const endSymbolProps = {
        x: bestPoints.to.x - offset * Math.cos(angleRad),
        y: bestPoints.to.y - offset * Math.sin(angleRad),
        rotation: angleDeg,
    };

    return { points, startSymbolProps, endSymbolProps };
};


// --- ERD REUSABLE COMPONENTS ---

const EntityShape = React.memo(({ entity, isSelected }: { entity: Entity, isSelected: boolean }) => {
    const styles = ENTITY_STYLES[entity.type];
    const commonProps = {
        fill: styles.fill,
        stroke: isSelected ? '#007bff' : styles.stroke,
        strokeWidth: isSelected ? 3 : 2,
        shadowColor: "#000000",
        shadowBlur: 5,
        shadowOpacity: 0.2,
        shadowOffsetX: 2,
        shadowOffsetY: 2,
    };

    switch (entity.type) {
        case 'Entity': return <Rect {...commonProps} width={entity.width} height={entity.height} cornerRadius={8} />;
        case 'Action': return <Line {...commonProps} points={[entity.width / 2, 0, entity.width, entity.height / 2, entity.width / 2, entity.height, 0, entity.height / 2]} closed />;
        case 'Attribute': return <Ellipse {...commonProps} x={entity.width / 2} y={entity.height / 2} radiusX={entity.width / 2} radiusY={entity.height / 2} />;
        default: return <Rect {...commonProps} width={entity.width} height={entity.height} cornerRadius={8} />;
    }
});
const EntityComponent = React.memo(({ entity, isSelected, onDragMove, onDragEnd, onClick, onDblClick }: EntityComponentProps) => {
  const styles = ENTITY_STYLES[entity.type];
  const textWidth = entity.type === 'Action' ? entity.width * 0.7 : entity.width;
  const textHeight = entity.type === 'Action' ? entity.height * 0.7 : entity.height;
  return (
    <Group id={entity.id} x={entity.x} y={entity.y} draggable onDragMove={onDragMove} onDragEnd={onDragEnd} onClick={onClick} onTap={onClick} onDblClick={onDblClick} onDblTap={onDblClick}>
      <EntityShape entity={entity} isSelected={isSelected} />
      <Text text={entity.name} fontSize={18} fontFamily="Arial" fill={styles.textColor} width={textWidth} height={textHeight} x={(entity.width - textWidth) / 2} y={(entity.height - textHeight) / 2} padding={10} align="center" verticalAlign="middle" listening={false} />
    </Group>
  );
});
const CardinalitySymbol = React.memo(({ x, y, rotation, cardinality, onClick, onMouseEnter, onMouseLeave, name }: { name?: string; x: number; y: number; rotation: number; cardinality: Cardinality; onClick: (e: Konva.KonvaEventObject<MouseEvent>) => void; onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => void; onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => void }) => {
    const symbolColor = '#c0392b';
    const strokeWidth = 2;
    const renderSymbol = () => {
        switch (cardinality) {
            case 'ONE': return <Line points={[0, -8, 0, 8]} stroke={symbolColor} strokeWidth={strokeWidth} />;
            case 'MANY': return <Group><Line points={[0, 0, 12, -8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[0, 0, 12, 0]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[0, 0, 12, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /></Group>;
            case 'ONE_AND_ONLY_ONE': return <Group><Line points={[-2, -8, -2, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[2, -8, 2, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /></Group>;
            case 'ZERO_OR_ONE': return <Group><Line points={[12, -8, 12, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Circle x={4} y={0} radius={4} stroke={symbolColor} strokeWidth={strokeWidth} /></Group>;
            case 'ONE_OR_MANY': return <Group><Line points={[0, -8, 0, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[4, 0, 16, -8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[4, 0, 16, 0]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[4, 0, 16, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /></Group>;
            case 'ZERO_OR_MANY': return <Group><Line points={[12, 0, 24, -8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[12, 0, 24, 0]} stroke={symbolColor} strokeWidth={strokeWidth} /><Line points={[12, 0, 24, 8]} stroke={symbolColor} strokeWidth={strokeWidth} /><Circle x={4} y={0} radius={4} stroke={symbolColor} strokeWidth={strokeWidth} /></Group>;
            default: return null;
        }
    };
    return (<Group name={name} x={x} y={y} rotation={rotation} onClick={onClick} onTap={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>{renderSymbol()}</Group>);
});
const RelationshipLine = React.memo(({ fromEntity, toEntity, relationship, isSelected, onSelect, onCardinalityChange, showCardinality }: { fromEntity: Entity; toEntity: Entity; relationship: Relationship; isSelected: boolean; onSelect: (e: Konva.KonvaEventObject<MouseEvent>) => void; onCardinalityChange: (e: Konva.KonvaEventObject<MouseEvent>) => void; showCardinality: boolean; }) => {
    if (!fromEntity || !toEntity) return null;
    
    const { points, startSymbolProps, endSymbolProps } = calculateRelationshipRenderProps(fromEntity, toEntity);

    const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = 'pointer'; };
    const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => { const stage = e.target.getStage(); if (stage) stage.container().style.cursor = 'default'; };
    return (<Group id={relationship.id}><Line name="relationship-line" points={points} stroke={isSelected ? '#ff8c00' : '#34495e'} strokeWidth={isSelected ? 3 : 2} onClick={onSelect} onTap={onSelect} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />{showCardinality && (<><CardinalitySymbol name="start-cardinality" x={startSymbolProps.x} y={startSymbolProps.y} rotation={startSymbolProps.rotation} cardinality={relationship.startCardinality} onClick={onCardinalityChange} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} /><CardinalitySymbol name="end-cardinality" x={endSymbolProps.x} y={endSymbolProps.y} rotation={endSymbolProps.rotation} cardinality={relationship.endCardinality} onClick={onCardinalityChange} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} /></>)}</Group>);
});

// --- SQL COMPONENTS ---

const SqlCreateTable = ({ tableState, setTableState }) => {
  const { tableName, columns, generatedSql } = tableState;
  const setTableName = (name) => setTableState(prev => ({ ...prev, tableName: name, generatedSql: '' }));
  const setColumns = (cols) => setTableState(prev => ({ ...prev, columns: cols, generatedSql: '' }));
  const setGeneratedSql = (sql) => setTableState(prev => ({ ...prev, generatedSql: sql }));

  const handleAddColumn = () => setColumns([...columns, { id: crypto.randomUUID(), name: '', dataType: 'VARCHAR(255)', isPk: false, allowNull: true, defaultValue: '' }]);
  const handleRemoveColumn = (id: string) => setColumns(columns.filter(c => c.id !== id));
  
  const handleColumnChange = (id: string, field: string, value: string | boolean) => {
    setColumns(columns.map(c => c.id === id ? { ...c, [field]: value } : c));
  };
  
  const handleGenerateSql = () => {
    if (!tableName.trim()) { alert('테이블 이름을 입력하세요.'); return; }
    if (columns.some(c => !c.name.trim())) { alert('모든 컬럼의 이름을 입력하세요.'); return; }
    if (!columns.some(c => c.isPk)) { alert('기본 키(Primary Key)로 지정된 컬럼이 하나 이상 있어야 합니다.'); return; }

    const pkColumns = columns.filter(c => c.isPk).map(c => `\`${c.name}\``).join(', ');
    const columnDefs = columns.map(c => {
      let def = `  \`${c.name}\` ${c.dataType}`;
      if (!c.allowNull) def += ' NOT NULL';
      if (c.defaultValue.trim()) {
        const isNumeric = /^-?\d+(\.\d+)?$/.test(c.defaultValue);
        const isKeyword = ['CURRENT_TIMESTAMP', 'true', 'false', 'null'].includes(c.defaultValue.toUpperCase());
        if (isNumeric || isKeyword) {
          def += ` DEFAULT ${c.defaultValue}`;
        } else {
          def += ` DEFAULT '${c.defaultValue.replace(/'/g, "''")}'`;
        }
      }
      return def;
    }).join(',\n');

    const sql = `CREATE TABLE \`${tableName}\` (\n${columnDefs},\n  PRIMARY KEY (${pkColumns})\n);`;
    setGeneratedSql(sql);
  };

  return (
    <div className="sql-view-container">
      <h2>테이블 생성</h2>
      <div className="sql-form-group">
        <label htmlFor="tableName">테이블 이름</label>
        <input type="text" id="tableName" value={tableName} onChange={e => setTableName(e.target.value)} placeholder="예: users" />
      </div>

      <table className="column-table">
        <thead><tr><th>컬럼명</th><th>데이터 형식</th><th>기본키</th><th>NULL 허용</th><th>기본값</th><th>삭제</th></tr></thead>
        <tbody>
          {columns.map(col => (
            <tr key={col.id}>
              <td><input type="text" value={col.name} onChange={e => handleColumnChange(col.id, 'name', e.target.value)} placeholder="예: id"/></td>
              <td><input type="text" value={col.dataType} onChange={e => handleColumnChange(col.id, 'dataType', e.target.value)} /></td>
              <td><input type="checkbox" checked={col.isPk} onChange={e => handleColumnChange(col.id, 'isPk', e.target.checked)} /></td>
              <td><input type="checkbox" checked={col.allowNull} onChange={e => handleColumnChange(col.id, 'allowNull', e.target.checked)} /></td>
              <td><input type="text" value={col.defaultValue} onChange={e => handleColumnChange(col.id, 'defaultValue', e.target.value)} /></td>
              <td><button className="remove-col-btn" onClick={() => handleRemoveColumn(col.id)}>X</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="action-btn" style={{marginTop: '20px'}} onClick={handleAddColumn}>컬럼 추가</button>
      <button className="action-btn" style={{marginLeft: '10px'}} onClick={handleGenerateSql}>SQL 생성</button>
      {generatedSql && <div className="sql-output"><div className="sql-output-title">Generated SQL:</div><code>{generatedSql}</code></div>}
    </div>
  );
};

const SqlAlterTable = ({ alterState, setAlterState }) => {
    const { alterType, tableName, columnName, dataType, generatedSql } = alterState;
    
    const updateState = (field, value) => setAlterState(prev => ({ ...prev, [field]: value, generatedSql: '' }));

    const handleGenerateSql = () => {
        if (!tableName.trim()) { alert('테이블 이름을 입력하세요.'); return; }
        if (!columnName.trim()) { alert('컬럼 이름을 입력하세요.'); return; }
        
        let sql = `ALTER TABLE \`${tableName}\``;
        switch(alterType) {
            case 'ADD':
                sql += ` ADD COLUMN \`${columnName}\` ${dataType};`;
                break;
            case 'MODIFY':
                sql += ` MODIFY COLUMN \`${columnName}\` ${dataType};`;
                break;
            case 'DROP':
                sql += ` DROP COLUMN \`${columnName}\`;`;
                break;
        }
        setAlterState(prev => ({ ...prev, generatedSql: sql }));
    };

    return (
        <div className="sql-view-container">
            <h2>테이블 변경</h2>
            <div className="alter-type-selector">
                <label><input type="radio" name="alterType" value="ADD" checked={alterType === 'ADD'} onChange={() => updateState('alterType', 'ADD')} /> 추가</label>
                <label><input type="radio" name="alterType" value="MODIFY" checked={alterType === 'MODIFY'} onChange={() => updateState('alterType', 'MODIFY')} /> 수정</label>
                <label><input type="radio" name="alterType" value="DROP" checked={alterType === 'DROP'} onChange={() => updateState('alterType', 'DROP')} /> 삭제</label>
            </div>
            <div className="sql-form-group"><label htmlFor="alterTableName">테이블 이름</label><input type="text" id="alterTableName" value={tableName} onChange={e => updateState('tableName', e.target.value)} placeholder="예: users"/></div>
            <div className="sql-form-group"><label htmlFor="alterColumnName">컬럼 이름</label><input type="text" id="alterColumnName" value={columnName} onChange={e => updateState('columnName', e.target.value)} placeholder="예: email"/></div>
            {alterType !== 'DROP' && <div className="sql-form-group"><label htmlFor="alterDataType">데이터 형식</label><input type="text" id="alterDataType" value={dataType} onChange={e => updateState('dataType', e.target.value)}/></div>}
            <button className="action-btn" onClick={handleGenerateSql}>SQL 생성</button>
            {generatedSql && <div className="sql-output"><div className="sql-output-title">Generated SQL:</div><code>{generatedSql}</code></div>}
        </div>
    );
};


const SqlView = ({ view, createTableState, setCreateTableState, alterTableState, setAlterTableState }) => {
    if (view === 'CREATE') return <SqlCreateTable tableState={createTableState} setTableState={setCreateTableState} />;
    if (view === 'ALTER') return <SqlAlterTable alterState={alterTableState} setAlterState={setAlterTableState} />;
    return <div className="placeholder-text">툴바에서 '테이블 생성' 또는 '테이블 변경'을<br/>선택하여 시작하세요.</div>;
};


// --- ERD VIEW COMPONENT ---

const ErdView = React.forwardRef<Konva.Stage, ErdViewProps>(({
    entities, relationships, onStateChange,
    selectedEntityId, setSelectedEntityId,
    selectedRelationshipId, setSelectedRelationshipId,
    relationshipCreation, setRelationshipCreation,
    editingEntityId, setEditingEntityId,
    showCardinality,
    containerRef,
}, stageRef) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [textareaStyle, setTextareaStyle] = useState<React.CSSProperties>({ display: 'none' });
  
  const setEntities = useCallback((updater) => onStateChange(updater, prevRels => prevRels), [onStateChange]);
  const setRelationships = useCallback((updater) => onStateChange(prevEnts => prevEnts, updater), [onStateChange]);

  const updateTextareaPosition = useCallback(() => {
      const entity = entities.find(e => e.id === editingEntityId);
      const stage = (stageRef && 'current' in stageRef) ? stageRef.current : null;
      if (!entity || !stage || !containerRef.current) {
          setTextareaStyle({ display: 'none' });
          return;
      }
      const entityNode = stage.findOne(`#${entity.id}`);
      if (entityNode) {
          const styles = ENTITY_STYLES[entity.type];
          const textPosition = entityNode.getAbsolutePosition();
          const textWidth = entity.type === 'Action' ? entity.width * 0.7 : entity.width;
          const textHeight = entity.type === 'Action' ? entity.height * 0.7 : entity.height;
          const xOffset = (entity.width - textWidth) / 2;
          const yOffset = (entity.height - textHeight) / 2;

          setTextareaStyle({
              display: 'block',
              position: 'absolute',
              top: `${textPosition.y + yOffset + 5}px`,
              left: `${textPosition.x + xOffset + 5}px`,
              width: `${textWidth - 10}px`,
              height: `${textHeight - 10}px`,
              backgroundColor: styles.fill,
              color: styles.textColor,
              borderColor: styles.textColor,
          });
      }
  }, [editingEntityId, entities, containerRef, stageRef]);


  useEffect(() => {
    updateTextareaPosition();
    if (editingEntityId && textareaRef.current) {
      textareaRef.current.focus();
    }
    const container = containerRef.current;
    if (container) {
      window.addEventListener('resize', updateTextareaPosition);
      container.addEventListener('scroll', updateTextareaPosition);
      return () => {
        window.removeEventListener('resize', updateTextareaPosition);
        container.removeEventListener('scroll', updateTextareaPosition);
      }
    }
  }, [editingEntityId, updateTextareaPosition, containerRef]);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const draggedNode = e.target;
    const entityId = draggedNode.id();
    const currentPos = draggedNode.position();

    const draggedEntityData = entities.find(en => en.id === entityId);
    if (!draggedEntityData) return;
    
    const tempDraggedEntity = { ...draggedEntityData, x: currentPos.x, y: currentPos.y };

    relationships.forEach(rel => {
        if (rel.fromId === entityId || rel.toId === entityId) {
            const fromEntity = rel.fromId === entityId ? tempDraggedEntity : entities.find(en => en.id === rel.fromId);
            const toEntity = rel.toId === entityId ? tempDraggedEntity : entities.find(en => en.id === rel.toId);

            if (!fromEntity || !toEntity) return;

            const { points, startSymbolProps, endSymbolProps } = calculateRelationshipRenderProps(fromEntity, toEntity);
            
            const lineGroup = stage.findOne('#' + rel.id);
            if (lineGroup) {
                // FIX: The findOne method is only available on Container nodes (like Stage, Layer, Group), not on generic Nodes.
                // The result of stage.findOne() is a Node, so it must be cast to a Group to allow further findOne() calls.
                // Additionally, the found 'line' node must be cast to a Line to access its specific 'points' method.
                const line = (lineGroup as Konva.Group).findOne('.relationship-line');
                if(line) (line as Konva.Line).points(points);
                
                const startSymbol = (lineGroup as Konva.Group).findOne('.start-cardinality');
                if(startSymbol) {
                    startSymbol.position({x: startSymbolProps.x, y: startSymbolProps.y});
                    startSymbol.rotation(startSymbolProps.rotation);
                }

                const endSymbol = (lineGroup as Konva.Group).findOne('.end-cardinality');
                if(endSymbol) {
                    endSymbol.position({x: endSymbolProps.x, y: endSymbolProps.y});
                    endSymbol.rotation(endSymbolProps.rotation);
                }
            }
        }
    });
  }, [entities, relationships]);

    const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const node = e.currentTarget;
        setEntities(prev => prev.map(en => en.id === node.id() ? { ...en, x: node.x(), y: node.y() } : en));
    }, [setEntities]);

    const handleEntityDblClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const id = e.currentTarget.id();
        setRelationshipCreation({ active: false, fromId: null });
        setSelectedRelationshipId(null);
        setSelectedEntityId(null);
        setEditingEntityId(id);
    }, [setRelationshipCreation, setSelectedRelationshipId, setSelectedEntityId, setEditingEntityId]);


  const handleFinishEditing = useCallback(() => {
    if (!editingEntityId || !textareaRef.current) return;
    const newName = textareaRef.current.value;
    setEntities(prev => prev.map(e => e.id === editingEntityId ? {...e, name: newName} : e));
    setEditingEntityId(null);
  }, [editingEntityId, setEntities, setEditingEntityId]);

  const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleFinishEditing();
    }
    if (e.key === 'Escape') {
      setEditingEntityId(null);
    }
  }, [handleFinishEditing, setEditingEntityId]);

  const handleEntityClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const id = e.currentTarget.id();
    if (editingEntityId) {
        handleFinishEditing();
        setEditingEntityId(null);
    }

    if (!relationshipCreation.active) {
      setSelectedRelationshipId(null);
      setSelectedEntityId(id);
      return;
    }
    if (!relationshipCreation.fromId) {
      setSelectedEntityId(null);
      setRelationshipCreation({ active: true, fromId: id });
    } else {
        if (relationshipCreation.fromId === id) return;
        const fromId = relationshipCreation.fromId;
        const toId = id;
        const alreadyExists = relationships.some(rel => (rel.fromId === fromId && rel.toId === toId) || (rel.fromId === toId && rel.toId === fromId));
        if (alreadyExists) {
          alert('이미 관계가 설정되어 있는 상태라 관계를 생성할수 없습니다.');
          setRelationshipCreation({ active: false, fromId: null });
          return;
        }
        const newRelationship: Relationship = { id: crypto.randomUUID(), fromId: relationshipCreation.fromId, toId: id, startCardinality: 'ONE_AND_ONLY_ONE', endCardinality: 'ONE_AND_ONLY_ONE' };
        setRelationships(prev => [...prev, newRelationship]);
        setRelationshipCreation({ active: false, fromId: null });
    }
  }, [editingEntityId, relationshipCreation, relationships, setRelationships, setRelationshipCreation, setSelectedEntityId, setSelectedRelationshipId, setEditingEntityId, handleFinishEditing]);
  
  const handleRelationshipSelect = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const relationshipGroup = e.currentTarget.getParent();
    const id = relationshipGroup?.id();
    if (!id) return;

    if (editingEntityId) handleFinishEditing();
    setEditingEntityId(null);
    setRelationshipCreation({ active: false, fromId: null });
    setSelectedEntityId(null);
    setSelectedRelationshipId(id);
  }, [editingEntityId, handleFinishEditing, setEditingEntityId, setRelationshipCreation, setSelectedEntityId, setSelectedRelationshipId]);

  const handleCardinalityChange = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const symbolGroup = e.currentTarget;
    const relationshipGroup = symbolGroup.getParent();
    const relationshipId = relationshipGroup?.id();
    const point = symbolGroup.name().startsWith('start') ? 'start' : 'end';
    
    if (!relationshipId) return;

    setRelationships(prevRels =>
      prevRels.map(rel => {
        if (rel.id === relationshipId) {
          const targetProp = point === 'start' ? 'startCardinality' : 'endCardinality';
          const currentCardinality = rel[targetProp];
          const currentIndex = CARDINALITIES.indexOf(currentCardinality);
          const nextIndex = (currentIndex + 1) % CARDINALITIES.length;
          return { ...rel, [targetProp]: CARDINALITIES[nextIndex] };
        }
        return rel;
      })
    );
  }, [setRelationships]);

  const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if(e.target === e.target.getStage()) {
      if(editingEntityId) handleFinishEditing();
      setRelationshipCreation({ active: false, fromId: null });
      setSelectedRelationshipId(null);
      setSelectedEntityId(null);
    }
  }, [editingEntityId, handleFinishEditing, setRelationshipCreation, setSelectedRelationshipId, setSelectedEntityId]);
  

  const editingEntity = entities.find(e => e.id === editingEntityId);

  return (
    <div className={`canvas-container ${relationshipCreation.active ? 'relationship-mode' : ''}`} ref={containerRef}>
        <Stage width={3000} height={2000} ref={stageRef} onClick={handleStageClick} onTap={handleStageClick}>
          <Layer>
            {relationships.map((rel) => {
                const fromEntity = entities.find(e => e.id === rel.fromId);
                const toEntity = entities.find(e => e.id === rel.toId);
                if (!fromEntity || !toEntity) return null;
                return <RelationshipLine key={rel.id} fromEntity={fromEntity} toEntity={toEntity} relationship={rel} isSelected={selectedRelationshipId === rel.id} onSelect={handleRelationshipSelect} onCardinalityChange={handleCardinalityChange} showCardinality={showCardinality} />;
            })}
            {entities.map((entity) => <EntityComponent key={entity.id} entity={entity} isSelected={selectedEntityId === entity.id || relationshipCreation.fromId === entity.id} onDragMove={handleDragMove} onDragEnd={handleDragEnd} onClick={handleEntityClick} onDblClick={handleEntityDblClick} />)}
          </Layer>
        </Stage>
        {editingEntityId && <div className="entity-editor-wrapper"><textarea ref={textareaRef} style={textareaStyle} defaultValue={editingEntity?.name} onBlur={handleFinishEditing} onKeyDown={handleTextareaKeyDown} className="entity-editor"/></div>}
    </div>
  );
});


// --- MAIN APP COMPONENT ---

const App = () => {
  const [mode, setMode] = useState<'ERD' | 'SQL'>('ERD');
  const [sqlView, setSqlView] = useState<'CREATE' | 'ALTER' | null>(null);

  // ERD State
  const [history, setHistory] = useState<{ entities: Entity[], relationships: Relationship[] }[]>([{ entities: [], relationships: [] }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const { entities, relationships } = history[historyIndex];
  
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [relationshipCreation, setRelationshipCreation] = useState<{ active: boolean; fromId: string | null }>({ active: false, fromId: null });
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [showCardinality, setShowCardinality] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const erdContainerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // SQL State
  const [createTableState, setCreateTableState] = useState({
      tableName: '',
      columns: [{ id: crypto.randomUUID(), name: '', dataType: 'VARCHAR(255)', isPk: false, allowNull: true, defaultValue: '' }],
      generatedSql: ''
  });
  const [alterTableState, setAlterTableState] = useState({
      alterType: 'ADD' as 'ADD' | 'MODIFY' | 'DROP',
      tableName: '',
      columnName: '',
      dataType: 'VARCHAR(255)',
      generatedSql: ''
  });

  const updateState = (entitiesUpdater, relationshipsUpdater) => {
    const newEntities = typeof entitiesUpdater === 'function' ? entitiesUpdater(entities) : entitiesUpdater;
    const newRelationships = typeof relationshipsUpdater === 'function' ? relationshipsUpdater(relationships) : relationshipsUpdater;
    const newHistory = history.slice(0, historyIndex + 1);
    setHistory([...newHistory, { entities: newEntities, relationships: newRelationships }]);
    setHistoryIndex(newHistory.length);
  };
  
  const handleUndo = () => { if (historyIndex > 0) setHistoryIndex(historyIndex - 1); };
  const handleRedo = () => { if (historyIndex < history.length - 1) setHistoryIndex(historyIndex + 1); };

  const handleDeleteSelected = useCallback(() => {
    if (selectedEntityId) {
        updateState(
            prev => prev.filter(e => e.id !== selectedEntityId),
            prev => prev.filter(r => r.fromId !== selectedEntityId && r.toId !== selectedEntityId)
        );
        setSelectedEntityId(null);
    } else if (selectedRelationshipId) {
        updateState(entities, prev => prev.filter(rel => rel.id !== selectedRelationshipId));
        setSelectedRelationshipId(null);
    }
  }, [selectedEntityId, selectedRelationshipId, entities, historyIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (mode === 'ERD') {
            const isEditing = !!editingEntityId;
            if (isEditing) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); handleUndo(); }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); handleRedo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); handleRedo(); }
            if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedRelationshipId || selectedEntityId)) { handleDeleteSelected(); }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, selectedRelationshipId, selectedEntityId, editingEntityId, handleDeleteSelected, handleUndo, handleRedo]);
  
  const handleAddEntity = (type: EntityType) => {
    const container = erdContainerRef.current;
    const spawnX = container ? container.scrollLeft + container.clientWidth / 2 - 75 : 50;
    const spawnY = container ? container.scrollTop + container.clientHeight / 2 - 40 : 50;
    
    const count = entities.filter(e => e.type === type).length + 1;
    const newEntity: Entity = {
        id: crypto.randomUUID(),
        x: spawnX,
        y: spawnY,
        width: type === 'Action' ? 120 : 150,
        height: type === 'Action' ? 120 : 75,
        name: `${type} ${count}`,
        type: type,
    };
    updateState(prev => [...prev, newEntity], relationships);
  };

  useLayoutEffect(() => {
    if (isExporting) {
        const stage = stageRef.current;
        if (stage) {
            const dataURL = stage.toDataURL({ mimeType: 'image/png', quality: 1, pixelRatio: 2 });
            const link = document.createElement('a');
            link.download = 'erd-diagram.png';
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
        setIsExporting(false);
    }
  }, [isExporting]);
  
  const handleExportImage = () => {
    setSelectedRelationshipId(null);
    setSelectedEntityId(null);
    setEditingEntityId(null);
    setIsExporting(true);
  };
  
  return (
    <div className="page-wrapper">
      <div className="app-container">
        <div className="toolbar">
          <div className="mode-switcher">
              <button className={mode === 'ERD' ? 'active' : ''} onClick={() => setMode('ERD')}>ERD 모드</button>
              <button className={mode === 'SQL' ? 'active' : ''} onClick={() => setMode('SQL')}>SQL 작성 모드</button>
          </div>
          <div className="toolbar-scroll-container">
            {mode === 'ERD' && (
                <>
                    <fieldset>
                        <legend>도형 추가</legend>
                        <button onClick={() => handleAddEntity('Entity')}>Entity</button>
                        <button onClick={() => handleAddEntity('Action')}>Action</button>
                        <button onClick={() => handleAddEntity('Attribute')}>Attribute</button>
                    </fieldset>
                     <fieldset>
                        <legend>편집</legend>
                        <div className="button-pair">
                            <button onClick={handleUndo} disabled={historyIndex === 0}>Undo</button>
                            <button onClick={handleRedo} disabled={historyIndex === history.length - 1}>Redo</button>
                        </div>
                        <button onClick={handleDeleteSelected} disabled={!selectedEntityId && !selectedRelationshipId}>선택 항목 삭제</button>
                    </fieldset>
                    <fieldset>
                        <legend>도구</legend>
                        <button onClick={() => { setEditingEntityId(null); setSelectedRelationshipId(null); setSelectedEntityId(null); setRelationshipCreation(prev => ({ active: !prev.active, fromId: null })); }} className={relationshipCreation.active ? 'active' : ''}>관계 추가</button>
                        <button onClick={() => setShowCardinality(prev => !prev)}>{showCardinality ? 'Cardinality 숨기기' : 'Cardinality 보이기'}</button>
                        <button onClick={handleExportImage}>이미지로 저장</button>
                    </fieldset>
                    {relationshipCreation.active && <div className="tooltip">{relationshipCreation.fromId ? '대상 엔티티 선택' : '시작 엔티티 선택'}</div>}
                </>
            )}
            
            {mode === 'SQL' && (
              <>
                <fieldset>
                    <legend>SQL 작업</legend>
                    <button onClick={() => setSqlView('CREATE')} className={sqlView === 'CREATE' ? 'active' : ''}>테이블 생성</button>
                    <button onClick={() => setSqlView('ALTER')} className={sqlView === 'ALTER' ? 'active' : ''}>테이블 변경</button>
                </fieldset>
              </>
            )}
          </div>
        </div>

        <div className={`main-content-area ${mode === 'ERD' ? 'erd-mode' : ''}`}>
          {mode === 'ERD' ? (
            <ErdView 
              ref={stageRef}
              entities={entities} relationships={relationships}
              onStateChange={updateState}
              selectedEntityId={selectedEntityId} setSelectedEntityId={setSelectedEntityId}
              selectedRelationshipId={selectedRelationshipId} setSelectedRelationshipId={setSelectedRelationshipId}
              relationshipCreation={relationshipCreation} setRelationshipCreation={setRelationshipCreation}
              editingEntityId={editingEntityId} setEditingEntityId={setEditingEntityId}
              showCardinality={showCardinality}
              containerRef={erdContainerRef}
            />
          ) : (
            <SqlView 
              view={sqlView}
              createTableState={createTableState} setCreateTableState={setCreateTableState}
              alterTableState={alterTableState} setAlterTableState={setAlterTableState}
            />
          )}
        </div>
      </div>
      <footer className="page-footer">
          <ins className="kakao_ad_area" 
                data-ad-unit = "DAN-UYvLxRjSAWSkaXPW"
                data-ad-width = "728"
                data-ad-height = "90"></ins>
            <script type="text/javascript" src="//t1.daumcdn.net/kas/static/ba.min.js" async></script>
        <div className="footer-info">
          <div className="footer-text">
            <p>
              © 2025 PRO(ProjectResolutionsOffice). All Rights Reserved.
              <br />
              프로그램 의뢰 및 문의: autocoding.pro@gmail.com
            </p>
          </div>
          <div className="social-links">
            <a href="https://www.instagram.com/projectresolutionsoffice/" target="_blank" rel="noopener noreferrer" title="Instagram">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
              </svg>
            </a>
            <a href="https://blog.naver.com/autocoding-" target="_blank" rel="noopener noreferrer" title="Naver Blog">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <text x="50%" y="54%" dominantBaseline="middle" textAnchor="middle" fontFamily="Arial, sans-serif" fontSize="16" fontWeight="bold" fill="currentColor">B</text>
              </svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

const container = document.getElementById('root');
if(container) {
    const root = createRoot(container);
    root.render(<App />);
}
