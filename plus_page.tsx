import React, { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo } from 'react';
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
  entities: { [id: string]: Entity };
  relationships: Relationship[];
  relationshipsById: { [id: string]: Relationship };
  entityToRelationshipMap: { [id: string]: string[] };
  // FIX: Use specific types instead of any for onStateChange to improve type safety and fix downstream inference errors.
  onStateChange: (entitiesUpdater: React.SetStateAction<{ [id: string]: Entity }> | null, relationshipsUpdater: React.SetStateAction<Relationship[]> | null) => void;
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


// --- ERD REUSABLE COMPONENTS with custom comparison ---

const areEntityShapesEqual = (prevProps, nextProps) => {
    return (
        prevProps.isSelected === nextProps.isSelected &&
        prevProps.entity.type === nextProps.entity.type &&
        prevProps.entity.width === nextProps.entity.width &&
        prevProps.entity.height === nextProps.entity.height
    );
};

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
}, areEntityShapesEqual);


const areEntitiesEqual = (prevProps, nextProps) => {
  const { entity: prevEntity, isSelected: prevIsSelected } = prevProps;
  const { entity: nextEntity, isSelected: nextIsSelected } = nextProps;

  return (
    prevIsSelected === nextIsSelected &&
    prevEntity.id === nextEntity.id &&
    prevEntity.x === nextEntity.x &&
    prevEntity.y === nextEntity.y &&
    prevEntity.width === nextEntity.width &&
    prevEntity.height === nextEntity.height &&
    prevEntity.name === nextEntity.name &&
    prevEntity.type === nextEntity.type
  );
};
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
}, areEntitiesEqual);


const areCardinalitySymbolsEqual = (prevProps, nextProps) => {
    return (
        prevProps.x === nextProps.x &&
        prevProps.y === nextProps.y &&
        prevProps.rotation === nextProps.rotation &&
        prevProps.cardinality === nextProps.cardinality
    );
}
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
}, areCardinalitySymbolsEqual);

// FIX: Define props interface for RelationshipComponent to resolve type errors.
interface RelationshipComponentProps {
    relationship: Relationship;
    fromEntity: Entity | undefined;
    toEntity: Entity | undefined;
    isSelected: boolean;
    onClick: () => void;
    onCardinalityClick: (relId: string, type: 'start' | 'end') => void;
    showCardinality: boolean;
}

const areRelationshipsEqual = (prevProps, nextProps) => {
  const { fromEntity: prevFrom, toEntity: prevTo, relationship: prevRel, isSelected: prevIsSelected, showCardinality: prevShowCardinality } = prevProps;
  const { fromEntity: nextFrom, toEntity: nextTo, relationship: nextRel, isSelected: nextIsSelected, showCardinality: nextShowCardinality } = nextProps;

  if (!prevFrom || !prevTo || !nextFrom || !nextTo) return false;

  return (
    prevIsSelected === nextIsSelected &&
    prevShowCardinality === nextShowCardinality &&
    prevRel.id === nextRel.id &&
    prevRel.startCardinality === nextRel.startCardinality &&
    prevRel.endCardinality === nextRel.endCardinality &&
    prevFrom.id === nextFrom.id && prevFrom.x === nextFrom.x && prevFrom.y === nextFrom.y && prevFrom.width === nextFrom.width && prevFrom.height === nextFrom.height &&
    prevTo.id === nextTo.id && prevTo.x === nextTo.x && prevTo.y === nextTo.y && prevTo.width === nextTo.width && prevTo.height === nextTo.height
  );
};
const RelationshipComponent = React.memo(({ relationship, fromEntity, toEntity, isSelected, onClick, onCardinalityClick, showCardinality }: RelationshipComponentProps) => {
    if (!fromEntity || !toEntity) return null;
    const { points, startSymbolProps, endSymbolProps } = calculateRelationshipRenderProps(fromEntity, toEntity);
    const strokeColor = isSelected ? '#007bff' : '#34495e';

    const handleCardinalityClick = (e, type) => {
        e.cancelBubble = true;
        onCardinalityClick(relationship.id, type);
    };

    const handleMouseEnter = e => e.target.getStage().container().style.cursor = 'pointer';
    const handleMouseLeave = e => e.target.getStage().container().style.cursor = 'default';

    return (
        <Group>
            <Line points={points} stroke={strokeColor} strokeWidth={2} onClick={onClick} onTap={onClick} hitStrokeWidth={10} />
            {showCardinality && (
                <>
                    <CardinalitySymbol name="start" {...startSymbolProps} cardinality={relationship.startCardinality} onClick={e => handleCardinalityClick(e, 'start')} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />
                    <CardinalitySymbol name="end" {...endSymbolProps} cardinality={relationship.endCardinality} onClick={e => handleCardinalityClick(e, 'end')} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} />
                </>
            )}
        </Group>
    );
}, areRelationshipsEqual);

const CardinalityMenu = ({ menuProps, onSelect, onOutsideClick }) => {
    const menuRef = useRef(null);
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                onOutsideClick();
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [onOutsideClick]);

    if (!menuProps) return null;

    const menuStyle: React.CSSProperties = {
        position: 'absolute',
        top: `${menuProps.y}px`,
        left: `${menuProps.x}px`,
        backgroundColor: 'white',
        border: '1px solid #ccc',
        borderRadius: '4px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
        zIndex: 100,
        padding: '5px 0',
    };

    const buttonStyle: React.CSSProperties = {
        display: 'block',
        width: '100%',
        padding: '8px 15px',
        border: 'none',
        background: 'none',
        textAlign: 'left',
        cursor: 'pointer',
    };

    return (
        <div ref={menuRef} style={menuStyle}>
            {CARDINALITIES.map(c => (
                <button key={c} style={buttonStyle} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f0f0'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'} onClick={() => onSelect(c)}>
                    {c.replace(/_/g, ' ')}
                </button>
            ))}
        </div>
    );
};

// --- ERD VIEW ---

const ErdView = ({
  entities, relationships, relationshipsById, entityToRelationshipMap, onStateChange,
  selectedEntityId, setSelectedEntityId,
  selectedRelationshipId, setSelectedRelationshipId,
  relationshipCreation, setRelationshipCreation,
  editingEntityId, setEditingEntityId,
  showCardinality, containerRef
}) => {
    const stageRef = useRef<Konva.Stage>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const [cardinalityMenuProps, setCardinalityMenuProps] = useState(null);

    // FIX: Simplify updateState to be a correctly-typed proxy, fixing a bug with array state updates and improving type safety.
    const updateState: ((entitiesUpdater: React.SetStateAction<{ [id: string]: Entity; }>, relationshipsUpdater?: null | undefined) => void) & ((entitiesUpdater: null, relationshipsUpdater: React.SetStateAction<Relationship[]>) => void) = (
        entitiesUpdater, 
        relationshipsUpdater
        ) => {
        onStateChange(entitiesUpdater, relationshipsUpdater);
    };

    const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
        const id = e.target.id();
        updateState(prev => ({ ...prev, [id]: { ...prev[id], x: e.target.x(), y: e.target.y() } }), null);
    }, [updateState]);

    const handleEntityClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        const entityId = e.target.id();
        if (relationshipCreation.active && relationshipCreation.fromId && relationshipCreation.fromId !== entityId) {
            const newRelationship: Relationship = { id: `rel_${Date.now()}`, fromId: relationshipCreation.fromId, toId: entityId, startCardinality: 'ONE', endCardinality: 'ONE' };
            updateState(null, prev => [...prev, newRelationship]);
            setRelationshipCreation({ active: false, fromId: null });
        } else {
            setSelectedEntityId(entityId);
            setSelectedRelationshipId(null);
        }
    }, [relationshipCreation, updateState, setRelationshipCreation, setSelectedEntityId, setSelectedRelationshipId]);

    const handleRelationshipClick = useCallback((id: string) => {
        setSelectedRelationshipId(id);
        setSelectedEntityId(null);
    }, [setSelectedRelationshipId, setSelectedEntityId]);

    const handleStageClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        if (e.target === stageRef.current) {
            setSelectedEntityId(null);
            setSelectedRelationshipId(null);
            setEditingEntityId(null);
            if (relationshipCreation.active) {
                setRelationshipCreation({ active: false, fromId: null });
            }
        }
    }, [setSelectedEntityId, setSelectedRelationshipId, setEditingEntityId, relationshipCreation, setRelationshipCreation]);

    const handleEntityDblClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
        e.evt.preventDefault();
        const id = e.target.id();
        setEditingEntityId(id);
    }, [setEditingEntityId]);

    const handleCardinalityMenu = useCallback((relId: string, type: 'start' | 'end') => {
        if (!stageRef.current) return;
        const rel = relationshipsById[relId];
        const fromEntity = entities[rel.fromId];
        const toEntity = entities[rel.toId];
        if (!fromEntity || !toEntity) return;

        const { startSymbolProps, endSymbolProps } = calculateRelationshipRenderProps(fromEntity, toEntity);
        const props = type === 'start' ? startSymbolProps : endSymbolProps;
        const pos = stageRef.current.getPointerPosition();
        
        setCardinalityMenuProps({
            x: pos.x,
            y: pos.y,
            onSelect: (cardinality: Cardinality) => {
                const key = type === 'start' ? 'startCardinality' : 'endCardinality';
                updateState(null, prev => prev.map(r => r.id === relId ? { ...r, [key]: cardinality } : r));
                setCardinalityMenuProps(null);
            }
        });
    }, [entities, relationshipsById, updateState]);

    // Effect for handling textarea editing
    useEffect(() => {
        if (editingEntityId && textareaRef.current) {
            const entity = entities[editingEntityId];
            const textarea = textareaRef.current;
            textarea.value = entity.name;
            textarea.style.display = 'block';
            textarea.style.position = 'absolute';
            textarea.style.top = `${entity.y}px`;
            textarea.style.left = `${entity.x}px`;
            textarea.style.width = `${entity.width}px`;
            textarea.style.height = `${entity.height}px`;
            textarea.focus();
        } else if (textareaRef.current) {
            textareaRef.current.style.display = 'none';
        }
    }, [editingEntityId, entities]);

    const handleTextareaBlur = useCallback(() => {
        if (!editingEntityId) return;
        const newName = textareaRef.current.value;
        updateState(prev => ({...prev, [editingEntityId]: { ...prev[editingEntityId], name: newName }}), null);
        setEditingEntityId(null);
    }, [editingEntityId, updateState, setEditingEntityId]);

    const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleTextareaBlur();
        } else if (e.key === 'Escape') {
            setEditingEntityId(null);
        }
    }, [handleTextareaBlur, setEditingEntityId]);

    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const checkSize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        checkSize();
        window.addEventListener('resize', checkSize);
        return () => window.removeEventListener('resize', checkSize);
    }, [containerRef]);
    
    return (
        <div className={`canvas-container ${relationshipCreation.active ? 'relationship-mode' : ''}`}>
             <Stage width={dimensions.width || window.innerWidth} height={dimensions.height || window.innerHeight} ref={stageRef} onClick={handleStageClick} onTap={handleStageClick}>
                <Layer>
                    {relationships.map(rel => (
                        <RelationshipComponent
                            key={rel.id}
                            relationship={rel}
                            fromEntity={entities[rel.fromId]}
                            toEntity={entities[rel.toId]}
                            isSelected={rel.id === selectedRelationshipId}
                            onClick={() => handleRelationshipClick(rel.id)}
                            onCardinalityClick={handleCardinalityMenu}
                            showCardinality={showCardinality}
                        />
                    ))}
                    {Object.values(entities).map(entity => (
                        <EntityComponent
                            key={entity.id}
                            entity={entity}
                            isSelected={entity.id === selectedEntityId}
                            onDragEnd={handleDragEnd}
                            onDragMove={e => {
                              const container = e.target.getStage().container();
                              container.style.cursor = "grabbing";
                            }}
                            onClick={handleEntityClick}
                            onDblClick={handleEntityDblClick}
                        />
                    ))}
                </Layer>
            </Stage>
            <div className="entity-editor-wrapper">
                <textarea
                    ref={textareaRef}
                    className="entity-editor"
                    style={{ display: 'none' }}
                    onBlur={handleTextareaBlur}
                    onKeyDown={handleTextareaKeyDown}
                />
            </div>
            <CardinalityMenu
                menuProps={cardinalityMenuProps}
                onSelect={(cardinality) => cardinalityMenuProps?.onSelect(cardinality)}
                onOutsideClick={() => setCardinalityMenuProps(null)}
            />
        </div>
    );
};

// --- SQL VIEW COMPONENTS ---

const dataTypes = ["INT", "VARCHAR(255)", "TEXT", "DATE", "DATETIME", "BOOLEAN", "DECIMAL(10, 2)", "FLOAT", "DOUBLE", "CHAR(1)"];

const ColumnRow = ({ column, index, updateColumn, removeColumn }) => (
    <tr>
        <td><input type="text" value={column.name} onChange={e => updateColumn(index, 'name', e.target.value)} placeholder="column_name" /></td>
        <td>
            <select value={column.type} onChange={e => updateColumn(index, 'type', e.target.value)}>
                {dataTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
        </td>
        <td><input type="checkbox" checked={column.isPk} onChange={e => updateColumn(index, 'isPk', e.target.checked)} /></td>
        <td><input type="checkbox" checked={column.isFk} onChange={e => updateColumn(index, 'isFk', e.target.checked)} /></td>
        <td><input type="checkbox" checked={column.isNotNull} onChange={e => updateColumn(index, 'isNotNull', e.target.checked)} /></td>
        <td><input type="checkbox" checked={column.isUnique} onChange={e => updateColumn(index, 'isUnique', e.target.checked)} /></td>
        <td><input type="text" value={column.defaultValue} onChange={e => updateColumn(index, 'defaultValue', e.target.value)} placeholder="NULL" /></td>
        <td><button className="remove-col-btn" onClick={() => removeColumn(index)}>X</button></td>
    </tr>
);

const CreateTableForm = ({ onGenerate }) => {
    const [tableName, setTableName] = useState('');
    const [columns, setColumns] = useState([{ name: '', type: 'INT', isPk: false, isFk: false, isNotNull: false, isUnique: false, defaultValue: '' }]);

    const addColumn = () => setColumns([...columns, { name: '', type: 'INT', isPk: false, isFk: false, isNotNull: false, isUnique: false, defaultValue: '' }]);
    const removeColumn = index => setColumns(columns.filter((_, i) => i !== index));
    const updateColumn = (index, field, value) => {
        const newColumns = [...columns];
        newColumns[index][field] = value;
        setColumns(newColumns);
    };

    const generateSQL = () => {
        let sql = `CREATE TABLE \`${tableName || 'your_table'}\` (\n`;
        const colDefs = columns.map(c => {
            if (!c.name) return null;
            let def = `  \`${c.name}\` ${c.type}`;
            if (c.isNotNull) def += ' NOT NULL';
            if (c.isUnique) def += ' UNIQUE';
            if (c.defaultValue) def += ` DEFAULT ${/^\d+$/.test(c.defaultValue) ? c.defaultValue : `'${c.defaultValue}'`}`;
            return def;
        }).filter(Boolean);

        const pkCols = columns.filter(c => c.isPk).map(c => `\`${c.name}\``);
        if (pkCols.length > 0) {
            colDefs.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
        }
        
        sql += colDefs.join(',\n');
        sql += '\n);';
        onGenerate(sql);
    };

    return (
        <div>
            <h2>CREATE TABLE Statement</h2>
            <div className="sql-form-group">
                <label htmlFor="tableName">Table Name:</label>
                <input id="tableName" type="text" value={tableName} onChange={e => setTableName(e.target.value)} placeholder="e.g., users" />
            </div>
            <table className="column-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Type</th>
                        <th>PK</th>
                        <th>FK</th>
                        <th>Not Null</th>
                        <th>Unique</th>
                        <th>Default</th>
                        <th>Remove</th>
                    </tr>
                </thead>
                <tbody>
                    {columns.map((col, i) => <ColumnRow key={i} column={col} index={i} updateColumn={updateColumn} removeColumn={removeColumn} />)}
                </tbody>
            </table>
            <button className="action-btn" onClick={addColumn} style={{ marginRight: '10px', backgroundColor: '#3498db' }}>Add Column</button>
            <button className="action-btn" onClick={generateSQL}>Generate SQL</button>
        </div>
    );
};

const AlterTableForm = ({ onGenerate }) => {
    const [tableName, setTableName] = useState('');
    const [alterType, setAlterType] = useState('ADD');
    const [column, setColumn] = useState({ name: '', type: 'INT' });
    const [newColumnName, setNewColumnName] = useState('');

    const generateSQL = () => {
        let sql = `ALTER TABLE \`${tableName || 'your_table'}\` `;
        switch (alterType) {
            case 'ADD':
                sql += `ADD COLUMN \`${column.name || 'new_column'}\` ${column.type};`;
                break;
            case 'DROP':
                sql += `DROP COLUMN \`${column.name || 'column_to_drop'}\`;`;
                break;
            case 'MODIFY':
                sql += `MODIFY COLUMN \`${column.name || 'column_to_modify'}\` ${column.type};`;
                break;
            case 'RENAME':
                sql += `RENAME COLUMN \`${column.name || 'old_name'}\` TO \`${newColumnName || 'new_name'}\`;`;
                break;
        }
        onGenerate(sql);
    };
    
    return (
        <div>
            <h2>ALTER TABLE Statement</h2>
            <div className="sql-form-group">
                <label>Table Name:</label>
                <input type="text" value={tableName} onChange={e => setTableName(e.target.value)} placeholder="e.g., users" />
            </div>
            <div className="alter-type-selector">
                {['ADD', 'DROP', 'MODIFY', 'RENAME'].map(type => (
                    <label key={type}>
                        <input type="radio" name="alterType" value={type} checked={alterType === type} onChange={() => setAlterType(type)} />
                        {type} Column
                    </label>
                ))}
            </div>
            <div className="sql-form-group">
                <label>Column Name:</label>
                <input type="text" value={column.name} onChange={e => setColumn({ ...column, name: e.target.value })} placeholder={alterType === 'RENAME' ? 'Old column name' : 'Column name'} />
            </div>
            {(alterType === 'ADD' || alterType === 'MODIFY') && (
                <div className="sql-form-group">
                    <label>Column Type:</label>
                    <select value={column.type} onChange={e => setColumn({ ...column, type: e.target.value })}>
                        {dataTypes.map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                </div>
            )}
            {alterType === 'RENAME' && (
                <div className="sql-form-group">
                    <label>New Column Name:</label>
                    <input type="text" value={newColumnName} onChange={e => setNewColumnName(e.target.value)} placeholder="New column name" />
                </div>
            )}
            <button className="action-btn" onClick={generateSQL}>Generate SQL</button>
        </div>
    );
};

const SqlView = () => {
    const [sqlType, setSqlType] = useState('CREATE');
    const [generatedSql, setGeneratedSql] = useState('');

    const renderForm = () => {
        switch (sqlType) {
            case 'CREATE': return <CreateTableForm onGenerate={setGeneratedSql} />;
            case 'ALTER': return <AlterTableForm onGenerate={setGeneratedSql} />;
            // Add other cases for INSERT, UPDATE, DELETE later
            default: return <div className="placeholder-text">Select a SQL command type to begin.</div>;
        }
    };
    
    return (
        <div className="sql-view-container">
            <div className="sql-form-group">
                <label htmlFor="sqlTypeSelect">SQL Command Type:</label>
                <select id="sqlTypeSelect" value={sqlType} onChange={e => { setSqlType(e.target.value); setGeneratedSql(''); }}>
                    <option value="CREATE">CREATE TABLE</option>
                    <option value="ALTER">ALTER TABLE</option>
                    <option value="INSERT" disabled>INSERT (Coming Soon)</option>
                    <option value="UPDATE" disabled>UPDATE (Coming Soon)</option>
                    <option value="DELETE" disabled>DELETE (Coming Soon)</option>
                </select>
            </div>
            {renderForm()}
            {generatedSql && (
                <div className="sql-output">
                    <div className="sql-output-title">Generated SQL:</div>
                    <pre><code>{generatedSql}</code></pre>
                </div>
            )}
        </div>
    );
}

// --- MAIN APP COMPONENT ---

const App = () => {
    const [entities, setEntities] = useState<{ [id: string]: Entity }>({});
    const [relationships, setRelationships] = useState<Relationship[]>([]);
    const [viewMode, setViewMode] = useState<'ERD' | 'SQL'>('ERD');
    const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
    const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
    const [relationshipCreation, setRelationshipCreation] = useState({ active: false, fromId: null });
    const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
    const [showCardinality, setShowCardinality] = useState(true);
    const containerRef = useRef(null);

    const { relationshipsById, entityToRelationshipMap } = useMemo(() => {
        const byId = {};
        const map = {};
        for (const rel of relationships) {
            byId[rel.id] = rel;
            if (!map[rel.fromId]) map[rel.fromId] = [];
            if (!map[rel.toId]) map[rel.toId] = [];
            map[rel.fromId].push(rel.id);
            map[rel.toId].push(rel.id);
        }
        return { relationshipsById: byId, entityToRelationshipMap: map };
    }, [relationships]);


    const addEntity = (type: EntityType) => {
        const id = `${type.toLowerCase()}_${Date.now()}`;
        const newEntity: Entity = { id, x: 100, y: 100, width: 150, height: 75, name: type, type, };
        setEntities(prev => ({ ...prev, [id]: newEntity }));
    };

    const deleteSelected = () => {
        if (selectedEntityId) {
            setEntities(prev => {
                const newEntities = { ...prev };
                delete newEntities[selectedEntityId];
                return newEntities;
            });
            // Also delete relationships connected to this entity
            setRelationships(prev => prev.filter(rel => rel.fromId !== selectedEntityId && rel.toId !== selectedEntityId));
            setSelectedEntityId(null);
        }
        if (selectedRelationshipId) {
            setRelationships(prev => prev.filter(rel => rel.id !== selectedRelationshipId));
            setSelectedRelationshipId(null);
        }
    };

    const toggleRelationshipCreation = () => {
        if (!selectedEntityId && !relationshipCreation.active) {
            alert("Please select an entity to start a relationship from.");
            return;
        }
        setRelationshipCreation(prev => ({
            active: !prev.active,
            fromId: !prev.active ? selectedEntityId : null,
        }));
    };
    
    const exportToPNG = () => {
        alert("Export functionality is being rebuilt and will be available soon!");
    };
    
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
                deleteSelected();
            }
            if (e.key === 'Escape') {
                setRelationshipCreation({ active: false, fromId: null });
                setSelectedEntityId(null);
                setSelectedRelationshipId(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedEntityId, selectedRelationshipId]);


    return (
      <div className="page-wrapper">
        <div className="app-container">
          <div className="toolbar">
              <div className="mode-switcher">
                  <button onClick={() => setViewMode('ERD')} className={viewMode === 'ERD' ? 'active' : ''}>ERD Mode</button>
                  <button onClick={() => setViewMode('SQL')} className={viewMode === 'SQL' ? 'active' : ''}>SQL Mode</button>
              </div>
              <div className="toolbar-scroll-container">
                  <fieldset>
                      <legend>Shapes</legend>
                      <button onClick={() => addEntity('Entity')}>Add Entity</button>
                      <button onClick={() => addEntity('Action')}>Add Action</button>
                      <button onClick={() => addEntity('Attribute')}>Add Attribute</button>
                  </fieldset>
                  <fieldset>
                      <legend>Tools</legend>
                      <button onClick={toggleRelationshipCreation} className={relationshipCreation.active ? 'active' : ''}>
                          {relationshipCreation.active ? "Cancel" : "Add Relationship"}
                      </button>
                      {relationshipCreation.active && <div className="tooltip">Click another entity to connect.</div>}
                       <div className="button-pair">
                          <button onClick={() => setShowCardinality(!showCardinality)}>
                              {showCardinality ? "Hide" : "Show"} Cardinality
                          </button>
                          <button onClick={deleteSelected} disabled={!selectedEntityId && !selectedRelationshipId}>Delete</button>
                      </div>
                  </fieldset>
                  <fieldset>
                      <legend>Export</legend>
                      <button onClick={exportToPNG}>Export as PNG</button>
                  </fieldset>
              </div>
          </div>
          <main ref={containerRef} className={`main-content-area ${viewMode === 'ERD' ? 'erd-mode' : ''}`}>
             {viewMode === 'ERD' ? (
                  <ErdView
                      entities={entities}
                      relationships={relationships}
                      relationshipsById={relationshipsById}
                      entityToRelationshipMap={entityToRelationshipMap}
                      onStateChange={(entitiesUpdater, relationshipsUpdater) => {
                          if (entitiesUpdater) setEntities(entitiesUpdater);
                          if (relationshipsUpdater) setRelationships(relationshipsUpdater);
                      }}
                      selectedEntityId={selectedEntityId}
                      setSelectedEntityId={setSelectedEntityId}
                      selectedRelationshipId={selectedRelationshipId}
                      setSelectedRelationshipId={setSelectedRelationshipId}
                      relationshipCreation={relationshipCreation}
                      setRelationshipCreation={setRelationshipCreation}
                      editingEntityId={editingEntityId}
                      setEditingEntityId={setEditingEntityId}
                      showCardinality={showCardinality}
                      containerRef={containerRef}
                  />
              ) : (
                  <SqlView />
              )}
          </main>
        </div>

        <footer className="page-footer">
          <div className="footer-info">
            <div className="social-links">
                <a href="https://github.com/autocoding-pro" target="_blank" rel="noopener noreferrer" aria-label="Github">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.91 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
                </a>
                <a href="https://www.instagram.com/autocoding_pro" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.85s-.011 3.584-.069 4.85c-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07s-3.584-.012-4.85-.07c-3.252-.148-4.771-1.691-4.919-4.919-.058-1.265-.069-1.645-.069-4.85s.011-3.584.069-4.85c.149-3.225 1.664 4.771 4.919 4.919 1.266-.057 1.644-.069 4.85-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948s.014 3.667.072 4.947c.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072s3.667-.014 4.947-.072c4.358-.2 6.78-2.618 6.98-6.98.059-1.281.073-1.689.073-4.948s-.014-3.667-.072-4.947c-.2-4.358-2.618-6.78-6.98-6.98-1.281-.059-1.689-.073-4.948-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.162 6.162 6.162 6.162-2.759 6.162-6.162-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4s1.791-4 4-4 4 1.79 4 4-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44 1.441-.645 1.441-1.44-.645-1.44-1.441-1.44z"/></svg>
                </a>
            </div>
            <div className="footer-text">
                <p>© 2025 PRO(ProjectResolutionsOffice). All Rights Reserved.</p>
                <p>프로그램 의뢰 및 문의: autocoding.pro@gmail.com</p>
            </div>
          </div>
          <div className="footer-ad-container">
              <div className="ad-desktop">
                <ins className="kakao_ad_area" style={{display:"none"}}
                data-ad-unit = "DAN-6iQkP135T7A3hAAr"
                data-ad-width = "728"
                data-ad-height = "90"></ins>
                <script type="text/javascript" src="//t1.daumcdn.net/kas/static/ba.min.js" async></script>
              </div>
              <div className="ad-mobile">
                <ins className="kakao_ad_area" style={{display:"none"}}
                data-ad-unit = "DAN-NSynyUz6zR7D3J8R"
                data-ad-width = "320"
                data-ad-height = "100"></ins>
                <script type="text/javascript" src="//t1.daumcdn.net/kas/static/ba.min.js" async></script>
              </div>
          </div>
        </footer>
      </div>
    );
};

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
